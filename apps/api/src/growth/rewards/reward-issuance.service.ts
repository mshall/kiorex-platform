import { Injectable } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { encryptField } from '../../common/crypto';
import { newId } from '../../common/ids';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';
import { couponHash, generateCoupon } from './reward-coupon';
import { RewardEventsService } from './reward-events.service';
import { RewardLedgerService } from './reward-ledger.service';
import { addMonths, entryKey, yearStart } from './reward-math';
import { RewardPolicyService } from './reward-policy.service';
import { maxActiveLots, recoverableLossBlockDays, type RewardRules } from './reward-rules';

export type LotKind = 'REFERRER' | 'REFEREE' | 'REPEAT' | 'WELCOME' | 'GOODWILL' | 'CAMPAIGN' | 'PROMO' | 'REFUND_CREDIT' | 'RESTORED' | 'LOYALTY';
export type Funding = 'PLATFORM_MARKETING' | 'PLATFORM_SERVICE_RECOVERY' | 'PATIENT_REFUND';
export const SKIP_REASONS = ['REWARDS_OFF', 'ZERO_AMOUNT', 'ANNUAL_CAP', 'CAMPAIGN_CAP', 'BUDGET_EXHAUSTED', 'MAX_OPEN_BALANCE', 'RECOVERABLE_LOSS_BLOCK', 'MAX_ACTIVE_LOTS', 'CURRENCY_MISMATCH', 'QUALIFYING_VISIT_REQUIRED'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];
/** Kinds that exist only as the patient's own value or its restoration: they never count against promotional caps and are never reversed by a referral or fraud rule. */
const EXEMPT: ReadonlySet<LotKind> = new Set(['REFUND_CREDIT', 'RESTORED']);
/** Kinds the database trigger (S4) ties to a COMPLETED qualifying booking; the code also demands one for REPEAT. */
const NEEDS_VISIT: ReadonlySet<LotKind> = new Set(['REFERRER', 'REFEREE', 'REPEAT', 'WELCOME', 'CAMPAIGN']);

/** Policy answers read BEFORE a transaction opens (a transaction must never wait for a second pooled connection while it holds one). */
export interface IssuePolicy { rules: RewardRules; versionId: string; rewardsOn: boolean; mode: 'COUPON' | 'CREDIT' }
export interface IssueInput {
  kind: LotKind; sub: string; amountMinor: number; funding: Funding; idempotencyKey: string; reasonCode: string; actor: string;
  currency?: string; qualifyingBookingId?: string | null; relationshipId?: string | null; campaignId?: string | null; refundId?: string | null;
  scope?: Record<string, unknown>; expiresAt?: Date; mode?: 'COUPON' | 'CREDIT'; now?: Date; bookingId?: string | null;
  /** Pass the policy when issuing inside a caller's transaction. */
  pre?: IssuePolicy;
}
export type IssueResult = { status: 'ISSUED' | 'EXISTING'; lotId: string; mode: string; amountMinor: number } | { status: 'SKIPPED'; reason: SkipReason };

/**
 * Issuance of reward value (GRW-P2-B2): one transaction per issuance, serialised per owner. Order of the checks is the order of the safety rules: kill switch (growth.rewards), verified
 * qualifying visit (S4), currency (S8), recoverable-loss block, annual per-user cap, per-campaign cap, rule budget ceiling, maximum open balance (S3), active lots. Every cap is fail-closed:
 * a cap of 0 means "nothing may be issued" until the founder sets one (REWARD_RULES amounts, caps and ceiling all default to 0, AD-4). The database refuses the same violations underneath.
 */
@Injectable()
export class RewardIssuanceService {
  constructor(private readonly prisma: PrismaService, private readonly ledger: RewardLedgerService, private readonly policy: RewardPolicyService, private readonly events: RewardEventsService) {}

  async policySnapshot(): Promise<IssuePolicy> {
    const { rules, versionId } = await this.policy.rewardRules();
    return { rules, versionId, rewardsOn: await this.policy.rewardsOn(), mode: await this.policy.issueMode(rules) };
  }

  async issue(i: IssueInput, outer?: Tx): Promise<IssueResult> {
    const run = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => (outer ? fn(outer) : this.prisma.$transaction(fn, { timeout: 30_000, maxWait: 30_000 }));
    const now = i.now ?? new Date();
    if (!Number.isInteger(i.amountMinor) || i.amountMinor < 0) throw new RangeError('amountMinor must be a non-negative integer');
    const existing = await (outer ?? this.prisma).rewardLedgerEntry.findUnique({ where: { idempotencyKey: i.idempotencyKey }, include: { lot: true } });
    if (existing) return { status: 'EXISTING', lotId: existing.lotId, mode: existing.lot.mode, amountMinor: existing.amountMinor };
    if (i.amountMinor === 0) return { status: 'SKIPPED', reason: 'ZERO_AMOUNT' };
    const pol = i.pre ?? (await this.policySnapshot());
    const { rules, versionId } = pol;
    if (!EXEMPT.has(i.kind) && !pol.rewardsOn) return { status: 'SKIPPED', reason: 'REWARDS_OFF' };
    if ((i.currency ?? rules.currency) !== rules.currency) return { status: 'SKIPPED', reason: 'CURRENCY_MISMATCH' };
    if (NEEDS_VISIT.has(i.kind) && !i.qualifyingBookingId) return { status: 'SKIPPED', reason: 'QUALIFYING_VISIT_REQUIRED' };
    const mode = i.mode ?? pol.mode;
    const owner = i.sub;

    return run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`reward-issue:${owner}`}))`;
      const again = await tx.rewardLedgerEntry.findUnique({ where: { idempotencyKey: i.idempotencyKey }, include: { lot: true } });
      if (again) return { status: 'EXISTING' as const, lotId: again.lotId, mode: again.lot.mode, amountMinor: again.amountMinor };

      if (!EXEMPT.has(i.kind)) {
        const blocked = await tx.rewardRecoverableLoss.findFirst({ where: { sub: owner, createdAt: { gt: new Date(now.getTime() - recoverableLossBlockDays() * 86_400_000) } } });
        if (blocked) return { status: 'SKIPPED' as const, reason: 'RECOVERABLE_LOSS_BLOCK' as const };
        const skip = await this.capSkip(tx, rules, i, owner, now);
        if (skip) return { status: 'SKIPPED' as const, reason: skip };
        if (i.funding === 'PLATFORM_MARKETING') {
          const ceiling = rules.ruleBudgetCeilingMinor;
          if (ceiling <= 0 || i.amountMinor > ceiling) return { status: 'SKIPPED' as const, reason: 'BUDGET_EXHAUSTED' as const };
          const took = await tx.$queryRaw<{ ruleVersionId: string }[]>(Prisma.sql`
            INSERT INTO "RewardIssuanceBudget" ("ruleVersionId","issuedMinor","ceilingMinor","updatedAt") VALUES (${versionId}, ${i.amountMinor}, ${ceiling}, timezone('UTC', now()))
            ON CONFLICT ("ruleVersionId") DO UPDATE SET "issuedMinor" = "RewardIssuanceBudget"."issuedMinor" + ${i.amountMinor}, "updatedAt" = timezone('UTC', now())
            WHERE "RewardIssuanceBudget"."issuedMinor" + ${i.amountMinor} <= "RewardIssuanceBudget"."ceilingMinor" RETURNING "ruleVersionId"`);
          if (!took.length) return { status: 'SKIPPED' as const, reason: 'BUDGET_EXHAUSTED' as const };
        }
      }

      const household = await tx.rewardHousehold.findFirst({ where: { ownerSub: owner }, select: { id: true } });
      const expiresAt = i.expiresAt ?? addMonths(now, i.kind === 'REFUND_CREDIT' ? rules.credit.refundAsCredit.refundCreditExpiryMonths : rules.expiryMonths);
      const code = mode === 'COUPON' && i.kind !== 'RESTORED' && i.kind !== 'REFUND_CREDIT' ? generateCoupon() : null;
      const lot = await tx.rewardLot.create({ data: {
        id: newId('rwl'), market: GROWTH_DEFAULT_MARKET, sub: i.sub, ownerSub: owner, householdId: household?.id ?? null, kind: i.kind, mode: i.kind === 'REFUND_CREDIT' || i.kind === 'RESTORED' ? (i.mode ?? 'CREDIT') : mode,
        currency: rules.currency, amountMinor: i.amountMinor, status: 'ACTIVE', ruleVersionId: versionId, relationshipId: i.relationshipId ?? null, campaignId: i.campaignId ?? null, expiresAt,
        funding: i.funding, scope: (i.scope ?? {}) as Prisma.InputJsonValue, qualifyingBookingId: i.qualifyingBookingId ?? null, issuedBy: i.actor, reasonCode: i.reasonCode,
        couponCodeHash: code ? couponHash(code) : null, couponCodeSealed: code ? encryptField(code) : null,
      } });
      await this.ledger.append(tx, { lotId: lot.id, type: 'ISSUE', amountMinor: i.amountMinor, idempotencyKey: i.idempotencyKey, ruleVersionId: versionId, reasonCode: i.reasonCode, actor: i.actor, currency: rules.currency, bookingId: i.bookingId ?? i.qualifyingBookingId ?? null, relationshipId: i.relationshipId ?? null, refundId: i.refundId ?? null });
      await this.events.emit(tx, 'RewardIssued', 'RewardLot', lot.id, { lotRef: lot.id, market: lot.market, mode: lot.mode, amountMinor: lot.amountMinor, currency: lot.currency, reasonCode: i.reasonCode, idempotencyKey: i.idempotencyKey, at: now.toISOString() }, i.idempotencyKey);
      return { status: 'ISSUED' as const, lotId: lot.id, mode: lot.mode, amountMinor: lot.amountMinor };
    });
  }

  private async capSkip(tx: Tx, rules: RewardRules, i: IssueInput, owner: string, now: Date): Promise<SkipReason | null> {
    // S3: annual per-user cap (rolling 365 days, marketing-funded issuance), a cap of 0 refuses
    if (i.funding === 'PLATFORM_MARKETING') {
      const yr = await tx.$queryRaw<{ s: bigint }[]>(Prisma.sql`SELECT COALESCE(SUM(e."amountMinor"),0)::bigint AS s FROM "RewardLedgerEntry" e JOIN "RewardLot" l ON l."id" = e."lotId" WHERE e."type" = 'ISSUE' AND COALESCE(l."ownerSub", l."sub") = ${owner} AND l."funding" = 'PLATFORM_MARKETING' AND l."kind" NOT IN ('RESTORED','REFUND_CREDIT') AND e."createdAt" >= ${yearStart(now)}`);
      if (rules.perUserAnnualCapMinor <= 0 || Number(yr[0]?.s ?? 0) + i.amountMinor > rules.perUserAnnualCapMinor) return 'ANNUAL_CAP';
      if (i.campaignId) {
        const c = await tx.$queryRaw<{ s: bigint }[]>(Prisma.sql`SELECT COALESCE(SUM(e."amountMinor"),0)::bigint AS s FROM "RewardLedgerEntry" e JOIN "RewardLot" l ON l."id" = e."lotId" WHERE e."type" = 'ISSUE' AND l."campaignId" = ${i.campaignId}`);
        if (rules.perCampaignCapMinor <= 0 || Number(c[0]?.s ?? 0) + i.amountMinor > rules.perCampaignCapMinor) return 'CAMPAIGN_CAP';
      }
    }
    // S3: maximum open balance per patient and household (promotional and goodwill lots; the patient's own refunded money is tracked apart)
    const open = await tx.$queryRaw<{ s: bigint; n: bigint }[]>(Prisma.sql`SELECT COALESCE(SUM(b."available" + b."reserved"),0)::bigint AS s, COUNT(*)::bigint AS n FROM "RewardLot" l CROSS JOIN LATERAL reward_lot_balance(l."id") b WHERE COALESCE(l."ownerSub", l."sub") = ${owner} AND l."expiresAt" > ${now} AND l."status" IN ('ACTIVE','HELD') AND (b."available" + b."reserved" + b."held") > 0 AND l."funding" <> 'PATIENT_REFUND'`);
    if (Number(open[0]?.s ?? 0) + i.amountMinor > rules.credit.maxOpenBalanceMinor) return 'MAX_OPEN_BALANCE';
    if (Number(open[0]?.n ?? 0) >= maxActiveLots()) return 'MAX_ACTIVE_LOTS';
    return null;
  }
}

export const issueKey = (...parts: Array<string | number>) => entryKey('issue', ...parts);
