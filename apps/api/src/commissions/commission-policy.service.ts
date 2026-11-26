import { Injectable } from '@nestjs/common';
import { cfg } from '../common/config';
import { badRequest, forbidden } from '../common/errors';
import { GrowthConfigService, type ConfigActor } from '../growth/growth-public';
import { DEFAULT_MARKET, knownProfileCodes } from '../market/market-core-public';
import { PrismaService } from '../prisma/prisma.service';
import { COLLECTION_MODES } from './commission-collect';
import {
  COUNSEL_DEFAULT, COUNSEL_KIND, DISCLOSURE_DEFAULT, DISCLOSURE_KIND, PAYOUT_ROUTES, gateDecision, missingLanguages, parseCounsel, parseDisclosure, wordingSet,
  type CommissionDisclosure, type CounselSignoff, type GateDecision, type GateKind,
} from './commission-policy';

const MARKET_RE = /^[A-Z]{2}$/;
type Kind = typeof COUNSEL_KIND | typeof DISCLOSURE_KIND;
const KINDS: readonly string[] = [COUNSEL_KIND, DISCLOSURE_KIND];
const LIVE = ['ACTIVE', 'SUPERSEDED', 'ROLLED_BACK'];

/**
 * COM-3 commission policy gates, on top of the maker-checker GrowthConfigVersion pattern (a DIFFERENT super admin approves; append-only; effective-dated; audited by the config service):
 *  - COMMISSION_COUNSEL_SIGNOFF per market: gates which collection modes and payout routes may run in REAL mode (mock always allowed; NOT_REVIEWED by default = real money blocked);
 *  - COMMISSION_DISCLOSURE per market: provider-facing texts (AR and EN, free text) and whether an override reason is visible. No wording is shipped.
 * Nothing legal or numeric lives in this file: it only reads what the super admin approved.
 */
@Injectable()
export class CommissionPolicyService {
  constructor(private readonly prisma: PrismaService, private readonly config: GrowthConfigService) {}

  /** Real money moves only when the payment layer is in real mode; tests override this. */
  isReal(): boolean { return cfg().pspMode === 'real'; }

  private market(m: string | undefined): string {
    const v = (m ?? DEFAULT_MARKET).toUpperCase();
    if (!MARKET_RE.test(v)) throw badRequest('INVALID_MARKET', 'market must be a two-letter country code');
    return v;
  }

  private async rowInForce(kind: Kind, market: string, at: Date) {
    await this.config.activateDue(at);
    return this.prisma.growthConfigVersion.findFirst({ where: { kind, scope: 'MARKET', scopeId: market, status: { in: LIVE }, effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] }, orderBy: { effectiveFrom: 'desc' } });
  }

  /** The counsel record in force for a market (the NOT_REVIEWED default when none was approved). */
  async counselFor(market: string, at = new Date()): Promise<{ record: CounselSignoff; version: number | null; effectiveFrom: Date | null }> {
    const row = await this.rowInForce(COUNSEL_KIND, this.market(market), at);
    return { record: row ? parseCounsel(row.payload) : { ...COUNSEL_DEFAULT }, version: row?.version ?? null, effectiveFrom: row?.effectiveFrom ?? null };
  }
  async disclosureFor(market: string, at = new Date()): Promise<{ disclosure: CommissionDisclosure; version: number | null; effectiveFrom: Date | null }> {
    const row = await this.rowInForce(DISCLOSURE_KIND, this.market(market), at);
    return { disclosure: row ? parseDisclosure(row.payload) : { ...DISCLOSURE_DEFAULT, rateDisclosure: { ...DISCLOSURE_DEFAULT.rateDisclosure }, termsSummary: { ...DISCLOSURE_DEFAULT.termsSummary } }, version: row?.version ?? null, effectiveFrom: row?.effectiveFrom ?? null };
  }

  /** May this collection mode or payout route run in REAL mode in this market? `real` defaults to the deployed payment mode (mock always allowed). */
  async gate(market: string, kind: GateKind, key: string, real = this.isReal()): Promise<GateDecision> {
    const m = this.market(market);
    if (!real) return gateDecision(null, { kind, key, market: m, real });
    return gateDecision((await this.counselFor(m)).record, { kind, key, market: m, real });
  }

  /** Reason code when a deposit paid through `psp` may NOT be paid out in real mode for this organisation, else null. (The payout-run port.) */
  async payoutRouteBlock(orgRef: string, psp: string): Promise<string | null> {
    if (!this.isReal()) return null;
    const d = await this.gate(await this.marketOfOrg(orgRef), 'PAYOUT_ROUTE', psp.toUpperCase().replace(/-/g, '_'), true);
    return d.allowed ? null : d.reason;
  }

  /** The market of an organisation: its provider choice, else its newest claim, else the platform default market. */
  async marketOfOrg(orgRef: string): Promise<string> {
    const p = await this.prisma.commissionOrgProvider.findUnique({ where: { orgRef }, select: { market: true } });
    if (p?.market) return p.market;
    const c = await this.prisma.commissionClaim.findFirst({ where: { orgRef }, orderBy: { createdAt: 'desc' }, select: { market: true } });
    return c?.market ?? DEFAULT_MARKET;
  }

  /** Newest effective instant of the two records in force for a market, in milliseconds: part of the version of the organisation's rate view so a change reaches the product. */
  async stamp(market: string, at = new Date()): Promise<number> {
    const [c, d] = await Promise.all([this.rowInForce(COUNSEL_KIND, market, at), this.rowInForce(DISCLOSURE_KIND, market, at)]);
    return Math.max(c?.effectiveFrom?.getTime() ?? 0, d?.effectiveFrom?.getTime() ?? 0);
  }

  /** What an organisation's own admin / finance sees: read only. Counsel status only (no reviewer name, document or conditions). */
  async providerFacing(market: string, at = new Date()) {
    const [c, d] = await Promise.all([this.counselFor(market, at), this.disclosureFor(market, at)]);
    return {
      disclosure: { rateDisclosure: d.disclosure.rateDisclosure, termsSummary: d.disclosure.termsSummary, showOverrideReason: d.disclosure.showOverrideReason, wordingSet: wordingSet(d.disclosure) },
      counsel: { status: c.record.status, reviewedOn: c.record.reviewedOn || null },
    };
  }

  // ───────────── console reads ─────────────
  async markets(): Promise<string[]> {
    const rows = await this.prisma.growthConfigVersion.findMany({ where: { kind: { in: [...KINDS] }, scope: 'MARKET' }, select: { scopeId: true }, distinct: ['scopeId'] });
    return [...new Set([DEFAULT_MARKET, ...knownProfileCodes().filter((c) => MARKET_RE.test(c)), ...rows.map((r) => r.scopeId)])].sort();
  }

  private rowOut(r: Awaited<ReturnType<GrowthConfigService['get']>>) {
    return { id: r.id, kind: r.kind, version: r.version, status: r.status, payload: r.payload, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, createdBy: r.createdBy, createdAt: r.createdAt, approvedBy: r.approvedBy, approvedAt: r.approvedAt, reason: r.reason };
  }

  /** The whole page for one market: counsel record, disclosure, every real-mode gate and the history of both kinds (newest first). */
  async state(market: string, at = new Date()) {
    const m = this.market(market);
    const [c, d] = await Promise.all([this.counselFor(m, at), this.disclosureFor(m, at)]);
    const rows = await this.prisma.growthConfigVersion.findMany({ where: { kind: { in: [...KINDS] }, scope: 'MARKET', scopeId: m }, orderBy: [{ kind: 'asc' }, { version: 'desc' }], take: 200 });
    const real = this.isReal();
    const gates = [
      ...COLLECTION_MODES.map((k) => gateDecision(c.record, { kind: 'COLLECTION_MODE', key: k, market: m, real: true })),
      ...PAYOUT_ROUTES.map((k) => gateDecision(c.record, { kind: 'PAYOUT_ROUTE', key: k, market: m, real: true })),
    ];
    const pick = (k: Kind) => rows.filter((r) => r.kind === k).map((r) => this.rowOut(r));
    const pending = (k: Kind) => rows.find((r) => r.kind === k && (r.status === 'PENDING_APPROVAL' || r.status === 'DRAFT')) ?? null;
    return {
      market: m, paymentMode: real ? 'real' : 'mock',
      counsel: { record: c.record, version: c.version, effectiveFrom: c.effectiveFrom, source: c.version === null ? 'DEFAULT' : 'APPROVED', pending: pending(COUNSEL_KIND) ? this.rowOut(pending(COUNSEL_KIND)!) : null, history: pick(COUNSEL_KIND) },
      disclosure: { ...d, wordingSet: wordingSet(d.disclosure), missing: missingLanguages(d.disclosure), source: d.version === null ? 'DEFAULT' : 'APPROVED', pending: pending(DISCLOSURE_KIND) ? this.rowOut(pending(DISCLOSURE_KIND)!) : null, history: pick(DISCLOSURE_KIND) },
      gates, realBlocked: gates.filter((g) => !g.allowed).length,
    };
  }

  // ───────────── maker-checker ─────────────
  /** Propose a new version (a draft that is submitted at once). A reason is mandatory. effectiveFrom defaults to the approval time. */
  async propose(actor: ConfigActor, i: { kind: string; market: string; payload: Record<string, unknown>; reason: string; effectiveFrom?: string | null }) {
    if (!KINDS.includes(i.kind)) throw badRequest('INVALID_KIND', 'kind must be COMMISSION_COUNSEL_SIGNOFF or COMMISSION_DISCLOSURE');
    if (!i.reason || i.reason.trim().length < 5) throw badRequest('REASON_REQUIRED', 'A reason of at least 5 characters is required');
    const market = this.market(i.market);
    let from: Date | null = null;
    if (i.effectiveFrom) { from = new Date(i.effectiveFrom); if (Number.isNaN(from.getTime())) throw badRequest('INVALID_EFFECTIVE_FROM', 'effectiveFrom is not a date'); if (from.getTime() < Date.now() - 60_000) throw badRequest('INVALID_EFFECTIVE_FROM', 'effectiveFrom must not be in the past'); }
    const draft = await this.config.createDraft(actor, { kind: i.kind, scope: 'MARKET', scopeId: market, payload: i.payload, effectiveFrom: from, reason: i.reason.slice(0, 300), ticket: undefined });
    return this.config.submit(actor, draft.id);
  }

  private async own(id: string) {
    const row = await this.config.get(id);
    if (!KINDS.includes(row.kind)) throw forbidden('NOT_A_COMMISSION_POLICY', 'This version is not a commission policy record');
    return row;
  }
  async decide(actor: ConfigActor, i: { id: string; approve: boolean; note?: string }) {
    await this.own(i.id);
    return i.approve ? this.config.approve(actor, i.id) : this.config.reject(actor, i.id, (i.note ?? 'rejected').slice(0, 300));
  }
}
