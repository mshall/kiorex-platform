import { DEFAULT_MARKET } from '../../market/market-core-public';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { growthPublic } from './assistant.growth-bridge';

export interface AssistantPolicy {
  languages: string[];
  toolsByState: Record<string, string[]>;
  budgets: { tokensPerTurn: number; tokensPerConversation: number; turnsPerConversation: number; tokensPerSubjectDay: number; costPerMarketDayMinor: number };
  rateLimits: { messagesPerNumberPerHour: number; globalConcurrency: number };
  retentionDays: number;
  escalationSlaMinutes: number;
  model: { mode: 'mock' | 'fixture' | 'real'; providerLabel: string };
  source: 'ACTIVE' | 'PROPOSED_DEFAULT';
  versionId: string;
}
const DEFAULTS: Omit<AssistantPolicy, 'source' | 'versionId'> = {
  languages: ['ar', 'en'], toolsByState: {},
  budgets: { tokensPerTurn: 1500, tokensPerConversation: 8000, turnsPerConversation: 40, tokensPerSubjectDay: 30_000, costPerMarketDayMinor: 200_000 },
  rateLimits: { messagesPerNumberPerHour: 30, globalConcurrency: 50 }, retentionDays: 30, escalationSlaMinutes: 30, model: { mode: 'mock', providerLabel: 'mock' },
};
const int = (n: unknown, d: number) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : d);

/** The ACTIVE ASSISTANT_POLICY version (maker-checker, two-person rule) or the PROPOSED_DEFAULT payload. Env overrides exist only for tests and local tuning (never read in production for model mode). */
@Injectable()
export class AssistantPolicyService {
  constructor(private readonly moduleRef: ModuleRef) {}
  async get(market = DEFAULT_MARKET): Promise<AssistantPolicy> {
    const { GrowthConfigService } = await growthPublic();
    const r = await this.moduleRef.get(GrowthConfigService, { strict: false }).resolve<Record<string, any>>('ASSISTANT_POLICY', { market });
    const p = r.payload ?? {};
    const b = p.budgets ?? {}; const rl = p.rateLimits ?? {};
    const env = (n: string) => { const v = Number(process.env[n]); return Number.isFinite(v) && process.env[n] !== undefined && process.env[n] !== '' ? v : undefined; };
    const policy: AssistantPolicy = {
      languages: Array.isArray(p.languages) ? p.languages : DEFAULTS.languages,
      toolsByState: p.toolsByState && typeof p.toolsByState === 'object' ? p.toolsByState : {},
      budgets: {
        tokensPerTurn: env('ASSISTANT_TEST_TOKENS_PER_TURN') ?? int(b.tokensPerTurn, DEFAULTS.budgets.tokensPerTurn),
        tokensPerConversation: env('ASSISTANT_TEST_TOKENS_PER_CONVERSATION') ?? int(b.tokensPerConversation, DEFAULTS.budgets.tokensPerConversation),
        turnsPerConversation: env('ASSISTANT_TEST_TURNS_PER_CONVERSATION') ?? int(b.turnsPerConversation, DEFAULTS.budgets.turnsPerConversation),
        tokensPerSubjectDay: env('ASSISTANT_TEST_TOKENS_PER_SUBJECT_DAY') ?? int(b.tokensPerSubjectDay, DEFAULTS.budgets.tokensPerSubjectDay),
        costPerMarketDayMinor: env('ASSISTANT_TEST_COST_PER_MARKET_DAY_MINOR') ?? int(b.costPerMarketDayMinor, DEFAULTS.budgets.costPerMarketDayMinor),
      },
      rateLimits: { messagesPerNumberPerHour: env('ASSISTANT_TEST_MESSAGES_PER_HOUR') ?? int(rl.messagesPerNumberPerHour, DEFAULTS.rateLimits.messagesPerNumberPerHour), globalConcurrency: env('ASSISTANT_TEST_CONCURRENCY') ?? int(rl.globalConcurrency, DEFAULTS.rateLimits.globalConcurrency) },
      retentionDays: int(p.retentionDays, DEFAULTS.retentionDays), escalationSlaMinutes: int(p.escalationSlaMinutes, DEFAULTS.escalationSlaMinutes),
      model: { mode: p.model?.mode === 'fixture' || p.model?.mode === 'real' ? p.model.mode : 'mock', providerLabel: String(p.model?.providerLabel ?? 'mock') },
      source: r.source, versionId: r.versionId,
    };
    return policy;
  }
}
