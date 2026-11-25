import { Injectable } from '@nestjs/common';
import { ApiError, conflict, notFound, unprocessable } from '../../common/errors';
import { newId } from '../../common/ids';
import { Prisma, type PartnershipProgram } from '../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GrowthLimiter } from '../growth-limiter';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';
import { LoyaltyEventsService } from './loyalty-events.service';
import { LoyaltyRedemptionAdapter } from './loyalty-redemption.adapter';
import { generatePartnershipCode, hashPartnershipCode, loyaltyHashOf, normalisePartnershipCode } from './partnership-code';

export interface PActor { sub: string; roles: string[] }
export const MAX_MINOR = 2_000_000_000;
/** The legal text of a program is counsel's: until a reference is entered, this placeholder stands in (NEEDS_HUMAN). It satisfies the database "has a reference" rule on purpose: the launch gate is the flag, not this text. */
export const LEGAL_TEXT_PLACEHOLDER = 'TODO_NEEDS_HUMAN: counsel legal text reference';
export interface ProgramInput {
  key?: string; partnerRef?: string; kind?: 'CODE_DISCOUNT' | 'CO_PROMO' | 'CARD_OFFER'; nameAr?: string; nameEn?: string; legalTextRef?: string | null;
  budgetMinor?: number; perRedemptionMinor?: number; startsAt?: string | null; endsAt?: string | null; fundingMode?: 'PLATFORM_MARKETING' | 'PARTNER_FUNDED';
}

/** The database says the reason first (trigger and CHECK messages start with a machine code); this maps the ones a person can act on. */
function dbMessage(e: unknown): string {
  const x = e as { message?: string; meta?: { driverAdapterError?: { cause?: { message?: string } } } };
  return x.meta?.driverAdapterError?.cause?.message ?? /Message: `([^`]*)`/.exec(x.message ?? '')?.[1] ?? '';
}
function dbProblem(e: unknown, at: 'redeem' | 'activate' = 'redeem'): ApiError | null {
  if (e instanceof ApiError) return e; // already a precise answer (for example a refused reward caps check inside the transaction)
  const m = dbMessage(e);
  const code = /^(PARTNERSHIP_[A-Z_]+|LOYALTY_[A-Z_]+)/.exec(m)?.[1];
  const text = m.replace(/^[A-Z_]+:\s*/, '');
  if (code === 'PARTNERSHIP_BUDGET_EXCEEDED' && at === 'activate') return unprocessable('PARTNERSHIP_BUDGET_EXCEEDED', text);
  if (code === 'PARTNERSHIP_BUDGET_EXCEEDED') return conflict('PARTNERSHIP_BUDGET_EXCEEDED', 'The offer budget is used up');
  if (code === 'PARTNERSHIP_CODE_EXHAUSTED') return unprocessable('PARTNERSHIP_CODE_EXHAUSTED', 'This code has been used up or has expired');
  if (code === 'PARTNERSHIP_NOT_ACTIVE') return unprocessable('PARTNERSHIP_NOT_ACTIVE', 'This offer is not active');
  if (code === 'PARTNERSHIP_FROZEN' || code === 'PARTNERSHIP_ENDED') return unprocessable(code, text);
  if (code) return unprocessable('PARTNERSHIP_TERMS_INCOMPLETE', text || 'The program terms are not complete');
  if (/active_check|amounts_check|window_check/.test(m)) return unprocessable('PARTNERSHIP_TERMS_INCOMPLETE', 'The program terms are not complete: a budget, a value, a window, a campaign, a legal text reference, platform funding and a second person are needed');
  return null;
}

/**
 * Partnership programs (GRW-P4-D): time-boxed, budgeted code offers of a partner (code discount, co-promotion, card offer). Approval goes through the CAMPAIGN path: a program runs only on a campaign of the
 * same market with the PARTNER channel that has been approved (maker-checker, hash-locked money payload) and is ACTIVE; the program is activated by a second person. The budget cap, the per-code limit, the per-person
 * limit and the campaign/lot match are enforced by database triggers, so a redemption that would pass the budget cannot be written even by a service bug. A redemption issues a PROMO reward lot of the P2-B2 ledger in one transaction.
 * Funding is Kiorex marketing money. A partner-funded program (money from the partner) can be drafted but never activated: that flow needs counsel and finance (NEEDS_HUMAN).
 * No message is sent by this module; any later message about a program goes through the lifecycle layer with its own consent and suppression checks.
 */
@Injectable()
export class PartnershipOfferService {
  constructor(private readonly prisma: PrismaService, private readonly adapter: LoyaltyRedemptionAdapter, private readonly events: LoyaltyEventsService, private readonly limiter: GrowthLimiter) {}

  private async audit(actor: string, action: string, id: string, metadata: Record<string, unknown> = {}) {
    await this.prisma.auditLog.create({ data: { actor, action: `growth.partnership.${action}`, resource: 'PartnershipProgram', resourceId: id, metadata: metadata as Prisma.InputJsonValue } });
  }
  private async load(id: string): Promise<PartnershipProgram> {
    const p = /^[A-Za-z0-9_-]{1,64}$/.test(id) ? await this.prisma.partnershipProgram.findUnique({ where: { id } }) : null;
    if (!p) throw notFound('PARTNERSHIP_NOT_FOUND', 'Partnership program not found');
    return p;
  }
  private checkDates(startsAt?: string | null, endsAt?: string | null) {
    const s = startsAt ? new Date(startsAt) : null; const e = endsAt ? new Date(endsAt) : null;
    if ((s && isNaN(s.getTime())) || (e && isNaN(e.getTime()))) throw new ApiError(400, 'PARTNERSHIP_INVALID', 'Dates are not valid');
    if (s && e && e <= s) throw new ApiError(400, 'PARTNERSHIP_INVALID', 'The end must be after the start');
    return { s, e };
  }

  async create(actor: PActor, i: ProgramInput) {
    if (!i.key || !/^[a-z0-9][a-z0-9-]{1,47}$/.test(i.key)) throw new ApiError(400, 'PARTNERSHIP_INVALID', 'A key of lower-case letters, digits and hyphens is required');
    if (!i.partnerRef || i.partnerRef.length > 80) throw new ApiError(400, 'PARTNERSHIP_INVALID', 'A partner reference (up to 80 characters) is required');
    if (!i.kind) throw new ApiError(400, 'PARTNERSHIP_INVALID', 'A kind is required');
    const { s, e } = this.checkDates(i.startsAt, i.endsAt);
    try {
      const p = await this.prisma.partnershipProgram.create({ data: {
        id: newId('ptp'), market: GROWTH_DEFAULT_MARKET, key: i.key, partnerRef: i.partnerRef.trim(), kind: i.kind, rules: { nameAr: i.nameAr?.slice(0, 120) ?? '', nameEn: i.nameEn?.slice(0, 120) ?? '' } as Prisma.InputJsonValue,
        fundingMode: i.fundingMode ?? 'PLATFORM_MARKETING', budgetMinor: i.budgetMinor ?? 0, perRedemptionMinor: i.perRedemptionMinor ?? 0, startsAt: s, endsAt: e, legalTextRef: i.legalTextRef?.trim() || LEGAL_TEXT_PLACEHOLDER, createdBy: actor.sub } });
      await this.audit(actor.sub, 'created', p.id, { key: p.key, kind: p.kind });
      return this.present(p);
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw conflict('PARTNERSHIP_KEY_TAKEN', 'A program with this key already exists');
      const x = dbProblem(err); if (x) throw x; throw err;
    }
  }

  async update(actor: PActor, id: string, i: ProgramInput) {
    const p = await this.load(id);
    if (p.status !== 'DRAFT') throw unprocessable('PARTNERSHIP_FROZEN', 'Only a draft program can be edited');
    const { s, e } = this.checkDates(i.startsAt !== undefined ? i.startsAt : p.startsAt?.toISOString(), i.endsAt !== undefined ? i.endsAt : p.endsAt?.toISOString());
    const rules = { ...(p.rules as Record<string, unknown>), ...(i.nameAr !== undefined ? { nameAr: i.nameAr.slice(0, 120) } : {}), ...(i.nameEn !== undefined ? { nameEn: i.nameEn.slice(0, 120) } : {}) };
    try {
      const u = await this.prisma.partnershipProgram.update({ where: { id }, data: {
        ...(i.partnerRef ? { partnerRef: i.partnerRef.trim() } : {}), ...(i.kind ? { kind: i.kind } : {}), ...(i.budgetMinor !== undefined ? { budgetMinor: i.budgetMinor } : {}), ...(i.perRedemptionMinor !== undefined ? { perRedemptionMinor: i.perRedemptionMinor } : {}),
        ...(i.fundingMode ? { fundingMode: i.fundingMode } : {}), ...(i.legalTextRef !== undefined ? { legalTextRef: i.legalTextRef?.trim() || LEGAL_TEXT_PLACEHOLDER } : {}), startsAt: s, endsAt: e, rules: rules as Prisma.InputJsonValue } });
      await this.audit(actor.sub, 'edited', id, { fields: Object.keys(i) });
      return this.present(u);
    } catch (err) { const x = dbProblem(err); if (x) throw x; throw err; }
  }

  /** Links the campaign that approves the program. The campaign must be in the same market and carry the PARTNER channel; its own approval (campaign path) is what lets the program run. */
  async linkCampaign(actor: PActor, id: string, campaignId: string) {
    const p = await this.load(id);
    if (p.status !== 'DRAFT') throw unprocessable('PARTNERSHIP_FROZEN', 'Only a draft program can change its campaign');
    const c = /^[A-Za-z0-9_-]{1,64}$/.test(campaignId) ? await this.prisma.growthCampaign.findUnique({ where: { id: campaignId }, select: { id: true, market: true, channels: true, status: true } }) : null;
    if (!c) throw notFound('CAMPAIGN_NOT_FOUND', 'Campaign not found');
    if (c.market !== p.market || !c.channels.includes('PARTNER')) throw unprocessable('PARTNERSHIP_TERMS_INCOMPLETE', 'The campaign must be in the same market and use the PARTNER channel');
    const u = await this.prisma.partnershipProgram.update({ where: { id }, data: { campaignId } });
    await this.audit(actor.sub, 'campaign_linked', id, { campaignId, campaignStatus: c.status });
    return this.present(u);
  }

  /** A second person activates (the creator cannot). The database re-checks the terms, the campaign (approved through its own maker-checker) and the budget against the campaign budget. */
  async activate(actor: PActor, id: string) {
    const p = await this.load(id);
    if (p.status === 'ACTIVE') return this.present(p);
    if (!['DRAFT', 'PAUSED'].includes(p.status)) throw unprocessable('PARTNERSHIP_NOT_ACTIVE', `A ${p.status} program cannot be activated`);
    if (p.createdBy === actor.sub) throw new ApiError(403, 'PARTNERSHIP_SELF_APPROVAL', 'The person who created a program cannot activate it');
    if (p.fundingMode !== 'PLATFORM_MARKETING') throw unprocessable('PARTNERSHIP_TERMS_INCOMPLETE', 'A partner-funded program needs counsel and finance sign-off before it can run (NEEDS_HUMAN)');
    try {
      const u = await this.prisma.partnershipProgram.update({ where: { id }, data: { status: 'ACTIVE', activatedBy: p.activatedBy && p.status === 'PAUSED' ? p.activatedBy : actor.sub, activatedAt: p.activatedAt ?? new Date() } });
      await this.audit(actor.sub, 'activated', id, {});
      return this.present(u);
    } catch (err) { const x = dbProblem(err, 'activate'); if (x) throw x; throw err; }
  }
  async pause(actor: PActor, id: string) {
    const p = await this.load(id);
    if (p.status !== 'ACTIVE') throw unprocessable('PARTNERSHIP_NOT_ACTIVE', 'Only an active program can be paused');
    const u = await this.prisma.partnershipProgram.update({ where: { id }, data: { status: 'PAUSED' } }); await this.audit(actor.sub, 'paused', id, {}); return this.present(u);
  }
  async end(actor: PActor, id: string) {
    const p = await this.load(id);
    if (p.status === 'ENDED') return this.present(p);
    const u = await this.prisma.partnershipProgram.update({ where: { id }, data: { status: 'ENDED' } }); await this.audit(actor.sub, 'ended', id, {}); return this.present(u);
  }

  async createCode(actor: PActor, id: string, i: { label: string; maxRedemptions: number; expiresAt?: string | null }) {
    const p = await this.load(id);
    if (p.status === 'ENDED') throw unprocessable('PARTNERSHIP_ENDED', 'An ended program cannot get codes');
    const plain = generatePartnershipCode({ length: 10, groupSize: 5 });
    const row = await this.prisma.partnershipCode.create({ data: { id: newId('ptc'), programId: id, codeHash: hashPartnershipCode(normalisePartnershipCode(plain)!), label: i.label.trim().slice(0, 80), maxRedemptions: i.maxRedemptions, expiresAt: i.expiresAt ? new Date(i.expiresAt) : null, createdBy: actor.sub } });
    await this.audit(actor.sub, 'code_created', id, { codeId: row.id, maxRedemptions: row.maxRedemptions });
    return { id: row.id, code: plain, label: row.label, maxRedemptions: row.maxRedemptions, expiresAt: row.expiresAt?.toISOString() ?? null, shownOnce: true as const };
  }
  async revokeCode(actor: PActor, id: string, codeId: string) {
    const c = await this.prisma.partnershipCode.findFirst({ where: { id: codeId, programId: id } });
    if (!c) throw notFound('PARTNERSHIP_NOT_FOUND', 'Code not found');
    await this.prisma.partnershipCode.update({ where: { id: codeId }, data: { status: 'REVOKED' } });
    await this.audit(actor.sub, 'code_revoked', id, { codeId });
    return { id: codeId, status: 'REVOKED' as const };
  }
  async codes(id: string) {
    await this.load(id);
    const rows = await this.prisma.partnershipCode.findMany({ where: { programId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
    const now = Date.now();
    return { items: rows.map((c) => ({ id: c.id, label: c.label, maxRedemptions: c.maxRedemptions, redeemedCount: c.redeemedCount, expiresAt: c.expiresAt?.toISOString() ?? null, status: c.status === 'REVOKED' ? 'REVOKED' : c.expiresAt && c.expiresAt.getTime() <= now ? 'EXPIRED' : c.redeemedCount >= c.maxRedemptions ? 'EXHAUSTED' : 'ACTIVE', createdAt: c.createdAt.toISOString() })) };
  }

  // ───────────────────────── reads for the ops console ─────────────────────────
  async list(q: { status?: string; take?: number } = {}) {
    const rows = await this.prisma.partnershipProgram.findMany({ where: { market: GROWTH_DEFAULT_MARKET, ...(q.status ? { status: q.status } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: Math.min(Math.max(q.take ?? 100, 1), 200), include: { campaign: { select: { id: true, key: true, name: true, status: true, budgetTotalMinor: true } } } });
    const used = await this.prisma.partnershipCodeRedemption.groupBy({ by: ['programId'], where: { programId: { in: rows.map((r) => r.id) } }, _sum: { amountMinor: true }, _count: { _all: true } });
    const m = new Map(used.map((u) => [u.programId, { minor: u._sum.amountMinor ?? 0, n: u._count._all }]));
    return { items: rows.map((r) => ({ ...this.present(r), campaign: r.campaign, usedMinor: m.get(r.id)?.minor ?? 0, redemptions: m.get(r.id)?.n ?? 0 })) };
  }
  async get(id: string) {
    const p = await this.prisma.partnershipProgram.findUnique({ where: { id: /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : '-' }, include: { campaign: { select: { id: true, key: true, name: true, status: true, budgetTotalMinor: true, channels: true } } } });
    if (!p) throw notFound('PARTNERSHIP_NOT_FOUND', 'Partnership program not found');
    const u = await this.prisma.partnershipCodeRedemption.aggregate({ where: { programId: id }, _sum: { amountMinor: true }, _count: { _all: true } });
    return { ...this.present(p), campaign: p.campaign, usedMinor: u._sum.amountMinor ?? 0, redemptions: u._count._all };
  }
  present(p: PartnershipProgram) {
    const r = p.rules as { nameAr?: string; nameEn?: string };
    return { id: p.id, market: p.market, key: p.key, partnerRef: p.partnerRef, kind: p.kind, nameAr: r.nameAr ?? '', nameEn: r.nameEn ?? '', status: p.status, fundingMode: p.fundingMode, budgetMinor: p.budgetMinor, perRedemptionMinor: p.perRedemptionMinor, currency: p.currency, startsAt: p.startsAt?.toISOString() ?? null, endsAt: p.endsAt?.toISOString() ?? null, campaignId: p.campaignId, legalTextRef: p.legalTextRef, legalTextIsPlaceholder: !p.legalTextRef || p.legalTextRef.startsWith('TODO_NEEDS_HUMAN'), createdBy: p.createdBy, activatedBy: p.activatedBy, createdAt: p.createdAt.toISOString() };
  }

  // ───────────────────────── the patient's redemption ─────────────────────────
  /** A patient redeems a code: one per person per program, a PROMO lot for the program's campaign in the same transaction as the redemption row. The database refuses the redemption that would pass the budget. */
  async redeem(sub: string, codeInput: string, now = new Date()) {
    await this.limiter.take('partnership-redeem', sub.slice(0, 24), 10, 3600_000);
    const norm = normalisePartnershipCode(codeInput);
    if (!norm) throw unprocessable('PARTNERSHIP_CODE_INVALID', 'This code is not valid');
    const code = await this.prisma.partnershipCode.findUnique({ where: { codeHash: hashPartnershipCode(norm) }, include: { program: { include: { campaign: { select: { status: true } } } } } });
    if (!code) throw unprocessable('PARTNERSHIP_CODE_INVALID', 'This code is not valid');
    const p = code.program; const personKey = loyaltyHashOf(sub);
    if (code.status !== 'ACTIVE') throw unprocessable('PARTNERSHIP_CODE_INVALID', 'This code is not valid');
    if (code.expiresAt && code.expiresAt <= now) throw unprocessable('PARTNERSHIP_CODE_EXPIRED', 'This code has expired');
    if (p.status !== 'ACTIVE' || !p.campaignId || !p.startsAt || !p.endsAt || now < p.startsAt || now >= p.endsAt || p.campaign?.status !== 'ACTIVE') throw unprocessable('PARTNERSHIP_NOT_ACTIVE', 'This offer is not active');
    if (code.redeemedCount >= code.maxRedemptions) throw unprocessable('PARTNERSHIP_CODE_EXHAUSTED', 'This code has been used up');
    const mine = await this.prisma.partnershipCodeRedemption.findUnique({ where: { programId_subHash: { programId: p.id, subHash: personKey } } });
    if (mine) throw conflict('PARTNERSHIP_ALREADY_REDEEMED', 'You have already used this offer');
    const pre = await this.adapter.policy();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const r = await this.adapter.issuePartnershipLot(tx, { sub, programId: p.id, campaignId: p.campaignId!, amountMinor: p.perRedemptionMinor, personKey, pre, now });
        if (r.status === 'SKIPPED') throw unprocessable('PARTNERSHIP_OFFER_UNAVAILABLE', 'This offer is not available right now', { reason: r.reason });
        const red = await tx.partnershipCodeRedemption.create({ data: { id: newId('pcr'), programId: p.id, codeId: code.id, subHash: personKey, lotId: r.lotId, amountMinor: p.perRedemptionMinor, idempotencyKey: `partner:${p.id}:${personKey}` } });
        await this.events.emit(tx, 'PartnershipCodeRedeemed', 'PartnershipProgram', p.id, { programRef: p.id, redemptionRef: red.id, lotRef: r.lotId, market: p.market, kind: p.kind, amountMinor: p.perRedemptionMinor, currency: p.currency, at: now.toISOString() }, red.id);
        const rules = p.rules as { nameAr?: string; nameEn?: string };
        return { redeemed: true as const, lotId: r.lotId, mode: r.mode, amountMinor: p.perRedemptionMinor, currency: p.currency, partner: { ar: rules.nameAr ?? '', en: rules.nameEn ?? '' }, legalTextRef: p.legalTextRef };
      }, { timeout: 30_000, maxWait: 30_000 });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw conflict('PARTNERSHIP_ALREADY_REDEEMED', 'You have already used this offer');
      const x = dbProblem(err); if (x) throw x; throw err;
    }
  }
}
