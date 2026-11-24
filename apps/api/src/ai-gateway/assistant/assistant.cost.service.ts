import { Injectable, Logger } from '@nestjs/common';
import { marketOffsetMinutes } from '../../common/market-time';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantAudit } from './assistant.audit';
import type { AssistantPolicy } from './assistant.config';
import { marketDate } from './assistant.lexicon';

export type BudgetVerdict = { ok: true } | { ok: false; reason: 'CONVERSATION_TOKENS' | 'CONVERSATION_TURNS' | 'SUBJECT_DAY' | 'MARKET_BREAKER' };

/**
 * Budgets and the cost breaker (policy ASSISTANT_POLICY): per-turn cap (checked by the orchestrator against the model's usage), per-conversation tokens and turns, per-subject daily tokens, and
 * the per-market daily cost cap in minor units. At 100 percent of the cap the breaker trips for the rest of the Cairo day (`AssistantBudgetBreakerTripped`: audit row + ops banner) and the router
 * returns DETERMINISTIC; a super admin can reset it. Mock mode costs 0 but counts synthetic tokens, so every budget is exercised.
 */
@Injectable()
export class AssistantCostService {
  private readonly log = new Logger('assistant-cost');
  constructor(private readonly prisma: PrismaService, private readonly audit: AssistantAudit) {}

  dayKey(now = new Date()) { return new Date(`${marketDate(now)}T00:00:00Z`); }
  private startOfMarketDay(now = new Date()) { return new Date(this.dayKey(now).getTime() - marketOffsetMinutes(now) * 60_000); }

  async breakerTripped(market: string, now = new Date()): Promise<boolean> {
    const row = await this.prisma.assistantUsageDaily.findUnique({ where: { day_market: { day: this.dayKey(now), market } } });
    return !!row?.breakerTripped;
  }

  async check(o: { market: string; sub: string | null; session: { turns: number; tokenBudgetUsed: number }; policy: AssistantPolicy; now?: Date }): Promise<BudgetVerdict> {
    const now = o.now ?? new Date(); const b = o.policy.budgets;
    if (await this.breakerTripped(o.market, now)) return { ok: false, reason: 'MARKET_BREAKER' };
    if (o.session.turns >= b.turnsPerConversation) return { ok: false, reason: 'CONVERSATION_TURNS' };
    if (o.session.tokenBudgetUsed >= b.tokensPerConversation) return { ok: false, reason: 'CONVERSATION_TOKENS' };
    if (o.sub) {
      const a = await this.prisma.assistantTurn.aggregate({ _sum: { tokensIn: true, tokensOut: true }, where: { session: { sub: o.sub }, createdAt: { gte: this.startOfMarketDay(now) } } });
      if ((a._sum.tokensIn ?? 0) + (a._sum.tokensOut ?? 0) >= b.tokensPerSubjectDay) return { ok: false, reason: 'SUBJECT_DAY' };
    }
    return { ok: true };
  }

  /** Adds this turn's usage to the session and to the market day; trips the breaker at 100 percent of the cost cap. */
  async record(o: { market: string; sessionId: string; tokens: number; costMinor: number; newConversation: boolean; policy: AssistantPolicy; now?: Date }) {
    const now = o.now ?? new Date(); const day = this.dayKey(now);
    await this.prisma.assistantSession.update({ where: { id: o.sessionId }, data: { tokenBudgetUsed: { increment: o.tokens }, costMinorUsed: { increment: o.costMinor } } });
    const row = await this.prisma.assistantUsageDaily.upsert({
      where: { day_market: { day, market: o.market } },
      create: { day, market: o.market, tokens: o.tokens, costMinor: o.costMinor, conversations: o.newConversation ? 1 : 0 },
      update: { tokens: { increment: o.tokens }, costMinor: { increment: o.costMinor }, ...(o.newConversation ? { conversations: { increment: 1 } } : {}) },
    });
    const cap = o.policy.budgets.costPerMarketDayMinor;
    if (!row.breakerTripped && cap > 0 && row.costMinor >= cap && row.costMinor - o.costMinor < cap) { // trips when THIS turn crosses the cap; a manual reset therefore holds until midnight Cairo
      await this.prisma.assistantUsageDaily.update({ where: { day_market: { day, market: o.market } }, data: { breakerTripped: true } });
      await this.audit.record('budget_breaker_tripped', null, { kind: 'AssistantBudgetBreakerTripped', market: o.market, costMinor: row.costMinor, breaker: true });
      this.log.warn(`AssistantBudgetBreakerTripped market=${o.market} cost=${row.costMinor}/${cap}`);
      return { tripped: true };
    }
    return { tripped: false };
  }

  async reset(market: string, actor: string, now = new Date()) {
    await this.prisma.assistantUsageDaily.updateMany({ where: { day: this.dayKey(now), market }, data: { breakerTripped: false } });
    await this.audit.record('budget_breaker_reset', null, { market, actor, breaker: false }, actor);
  }
}
