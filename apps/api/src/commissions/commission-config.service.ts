import { Injectable } from '@nestjs/common';
import { badRequest, conflict, forbidden, notFound } from '../common/errors';
import { newId } from '../common/ids';
import { cfg } from '../common/config';
import { PrismaService } from '../prisma/prisma.service';
import { PSP_NAMES, PspConfigService } from '../pay/pay-public';
import { type CollectionSettings, missingSettings, parseSettings, resolveSettings, settingsProblems } from './commission-collect';
import { CommissionRateService } from './commission-rate.service';
import type { RateProduct, RateSpec } from './commission-rate';

export type PolicyScope = 'MARKET' | 'ORG';
const MARKET_RE = /^[A-Z]{2}$/;
const ORG_RE = /^[A-Za-z0-9_-]{3,64}$/;

/**
 * Collection configuration with maker-checker (money-affecting): a MARKET default or an ORG override is PROPOSED by a super admin and becomes ACTIVE only when a DIFFERENT super admin
 * approves (the database CHECK repeats the rule). Versions are append-only; the previous ACTIVE one becomes SUPERSEDED. The organisation's provider choice is validated and audited.
 * No value is shipped: a market with no active default is simply "not configured" and collection does not run for it (LG-COM-1).
 */
@Injectable()
export class CommissionConfigService {
  constructor(private readonly prisma: PrismaService, private readonly psp: PspConfigService, private readonly rates: CommissionRateService) {}

  private async audit(actor: string, action: string, resourceId: string, metadata: Record<string, unknown>) {
    await this.prisma.auditLog.create({ data: { actor, action, resource: 'CommissionPolicy', resourceId, metadata: metadata as object } });
  }

  async propose(i: { scope: PolicyScope; scopeRef: string; settings: unknown; note?: string; actor: string }) {
    const ref = i.scope === 'MARKET' ? i.scopeRef.toUpperCase() : i.scopeRef;
    if (!(i.scope === 'MARKET' ? MARKET_RE : ORG_RE).test(ref)) throw badRequest('INVALID_SCOPE_REF', 'scopeRef is not a valid market code or organisation reference');
    const problems = settingsProblems(i.settings);
    if (problems.length) throw badRequest('INVALID_SETTINGS', 'The settings are not valid', { problems });
    const settings = parseSettings(i.settings);
    const open = await this.prisma.commissionPolicy.count({ where: { scope: i.scope, scopeRef: ref, status: 'PENDING' } });
    if (open) throw conflict('PROPOSAL_ALREADY_OPEN', 'Decide the open proposal before proposing another');
    const last = await this.prisma.commissionPolicy.findFirst({ where: { scope: i.scope, scopeRef: ref }, orderBy: { version: 'desc' }, select: { version: true } });
    const row = await this.prisma.commissionPolicy.create({ data: { id: newId('cpo'), scope: i.scope, scopeRef: ref, version: (last?.version ?? 0) + 1, settings: settings as object, note: i.note?.slice(0, 300), proposedBy: i.actor } });
    await this.audit(i.actor, 'commission.policy_proposed', row.id, { scope: i.scope, scopeRef: ref, version: row.version, settings });
    return row;
  }

  async decide(i: { id: string; approve: boolean; actor: string; note?: string }) {
    const row = await this.prisma.commissionPolicy.findUnique({ where: { id: i.id } });
    if (!row) throw notFound('POLICY_NOT_FOUND', 'No such proposal');
    if (row.status !== 'PENDING') throw conflict('ALREADY_DECIDED', 'This proposal was already decided');
    if (row.proposedBy === i.actor) throw forbidden('TWO_PERSON_RULE', 'A different super admin must decide this proposal (maker-checker)');
    const out = await this.prisma.$transaction(async (tx) => {
      if (i.approve) await tx.commissionPolicy.updateMany({ where: { scope: row.scope, scopeRef: row.scopeRef, status: 'ACTIVE' }, data: { status: 'SUPERSEDED' } });
      const claimed = await tx.commissionPolicy.updateMany({ where: { id: row.id, status: 'PENDING' }, data: { status: i.approve ? 'ACTIVE' : 'REJECTED', decidedBy: i.actor, decidedAt: new Date(), decisionNote: i.note?.slice(0, 300) } });
      if (claimed.count !== 1) throw conflict('ALREADY_DECIDED', 'This proposal was already decided');
      return tx.commissionPolicy.findUniqueOrThrow({ where: { id: row.id } });
    });
    await this.audit(i.actor, i.approve ? 'commission.policy_approved' : 'commission.policy_rejected', row.id, { scope: row.scope, scopeRef: row.scopeRef, version: row.version, proposedBy: row.proposedBy });
    return out;
  }

  list(q: { scope?: string; scopeRef?: string }) {
    return this.prisma.commissionPolicy.findMany({ where: { ...(q.scope ? { scope: q.scope } : {}), ...(q.scopeRef ? { scopeRef: q.scopeRef } : {}) }, orderBy: [{ scope: 'asc' }, { scopeRef: 'asc' }, { version: 'desc' }], take: 200 });
  }

  /** The settings that apply to one organisation now: org override field by field over the market default; plus what is still missing. */
  async effective(orgRef: string, market: string): Promise<{ settings: CollectionSettings; missing: string[]; marketPolicyId: string | null; orgPolicyId: string | null; rate: RateSpec | null }> {
    const [m, o] = await Promise.all([
      this.prisma.commissionPolicy.findFirst({ where: { scope: 'MARKET', scopeRef: market.toUpperCase(), status: 'ACTIVE' } }),
      this.prisma.commissionPolicy.findFirst({ where: { scope: 'ORG', scopeRef: orgRef, status: 'ACTIVE' } }),
    ]);
    const base = resolveSettings(m ? parseSettings(m.settings) : null, o ? parseSettings(o.settings) : null);
    // COM-2 / COM-3: whatever the organisation's effective rate (override or product default) sets wins over the collection settings, field by field; a null field follows the settings
    const link = await this.prisma.commissionOrgRateLink.findUnique({ where: { orgRef }, select: { product: true } });
    const rate = await this.rates.effectiveAt(orgRef, (link?.product as RateProduct | undefined) ?? 'CLINIC', new Date());
    const r = rate.spec;
    const settings: CollectionSettings = r ? {
      ...base, mode: r.mode ?? base.mode, graceDays: r.graceDays ?? base.graceDays, retryDays: r.retryDays ?? base.retryDays, minCollectMinor: r.minCollectMinor ?? base.minCollectMinor, invoiceDueDays: r.invoiceDueDays ?? base.invoiceDueDays,
    } : base;
    return { settings, missing: missingSettings(settings), marketPolicyId: m?.id ?? null, orgPolicyId: o?.id ?? null, rate: r };
  }

  /** Providers an organisation may choose for a market: the enabled ones in order of preference (mock mode: all, exactly like the deposit path). */
  async providersFor(market: string): Promise<string[]> {
    if (cfg().pspMode === 'sandbox-fake') return [...PSP_NAMES];
    const all = await this.psp.all(market.toUpperCase());
    return PSP_NAMES.filter((n) => all[n].enabled && (all[n].markets.includes('*') || all[n].markets.includes(market.toUpperCase()))).sort((a, b) => all[a].order - all[b].order);
  }

  async chooseProvider(i: { orgRef: string; market: string; provider: string; actor: string }) {
    if (!ORG_RE.test(i.orgRef)) throw badRequest('INVALID_ORG', 'Invalid organisation reference');
    const allowed = await this.providersFor(i.market);
    if (!allowed.includes(i.provider)) throw badRequest('PROVIDER_NOT_AVAILABLE', 'That payment provider is not enabled for this market', { allowed });
    const prev = await this.prisma.commissionOrgProvider.findUnique({ where: { orgRef: i.orgRef } });
    const row = await this.prisma.commissionOrgProvider.upsert({ where: { orgRef: i.orgRef }, create: { orgRef: i.orgRef, market: i.market.toUpperCase(), provider: i.provider, chosenBy: i.actor }, update: { provider: i.provider, market: i.market.toUpperCase(), chosenBy: i.actor } });
    await this.prisma.auditLog.create({ data: { actor: i.actor, action: 'commission.provider_chosen', resource: 'CommissionOrgProvider', resourceId: i.orgRef, metadata: { from: prev?.provider ?? null, to: i.provider, market: i.market } } });
    await this.prisma.commissionTimeline.create({ data: { orgRef: i.orgRef, subjectType: 'RUN', subjectId: `org:${i.orgRef}`, event: 'PROVIDER_CHOSEN', detail: { from: prev?.provider ?? null, to: i.provider }, actor: i.actor } });
    return row;
  }

  providerOf(orgRef: string) { return this.prisma.commissionOrgProvider.findUnique({ where: { orgRef } }); }
}
