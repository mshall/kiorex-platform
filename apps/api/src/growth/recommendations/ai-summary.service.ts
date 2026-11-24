import { Injectable, Logger } from '@nestjs/common';
import { outboundFetch } from '../../common/outbound-http';
import { FlagsService } from '../../control-plane/control-plane-public';
import { detectPhi } from '../../safety/safety-public';
import { healthWordIn } from '../automation/health-terms';
import { AI_RECOMMENDATIONS_FLAG } from '../automation/automation-flags';
import { assertAggregateOnly, checkAggregateOnly } from './assert-aggregate-only';
import type { BilingualText, RecommendationKind } from './recommendation.types';

/**
 * The narrative summary of a proposal (GRW-P3-E). OPTIONAL and advisory: the numbers and the rationale come from the deterministic rules; the model only rephrases them in two languages.
 * Modes: `rules` (no summary), `mock` (DEFAULT: a fixed template, no model, no network), `real` (OpenAI-compatible, config only). A real call needs ALL of: the policy says real,
 * `growth.ai_recommendations` REGISTERED in the flag catalogue and effective (gate evidence of the KX-11 governance review), `growth.assistant_real_model` effective, and
 * `RECOMMENDATION_MODEL_BASE_URL`, `RECOMMENDATION_MODEL`, `RECOMMENDATION_MODEL_API_KEY` set. Anything missing falls back to the mock summary. The model sees only the aggregate
 * payload (asserted before the call), never a person, and its answer is validated and scanned before it is stored: a bad answer is discarded and the proposal keeps its rule rationale.
 */
export type SummaryMode = 'rules' | 'mock' | 'real';
export interface SummaryInput { kind: RecommendationKind; payload: Record<string, unknown>; rationale: BilingualText }
export interface Summary { en: string; ar: string; mode: SummaryMode; label: 'AI-assisted'; model: string }
export interface SummaryModel { readonly name: string; readonly mode: 'mock' | 'real'; summarise(i: SummaryInput): Promise<BilingualText> }

export class MockSummaryModel implements SummaryModel {
  readonly name = 'mock'; readonly mode = 'mock' as const;
  async summarise(i: SummaryInput): Promise<BilingualText> {
    return { en: `Summary (mock): ${i.rationale.en}`.slice(0, 400), ar: `ملخص (تجريبي): ${i.rationale.ar}`.slice(0, 400) };
  }
}

export interface RealSummaryConfig { baseUrl: string; model: string; apiKey: string; timeoutMs?: number; fetchImpl?: typeof outboundFetch }
export const SUMMARY_SCHEMA = { type: 'object', additionalProperties: false, required: ['en', 'ar'], properties: { en: { type: 'string', maxLength: 400 }, ar: { type: 'string', maxLength: 400 } } } as const;
export const SUMMARY_SYSTEM_PROMPT = [
  'You rewrite one marketing-analytics recommendation for an operations team, in English and in Egyptian Arabic.',
  'Input is a JSON object of AGGREGATE numbers only. Use only those numbers. Never invent a figure, a person, a provider or a health topic. Never suggest sending, spending, targeting or building a list of people.',
  'Answer ONLY with JSON {"en": string, "ar": string}, each at most 400 characters, plain text, no URLs.',
].join('\n');

export class OpenAiCompatSummaryModel implements SummaryModel {
  readonly name: string; readonly mode = 'real' as const;
  constructor(private readonly c: RealSummaryConfig) { this.name = `openai-compat:${c.model}`; }
  async summarise(i: SummaryInput): Promise<BilingualText> {
    const f = this.c.fetchImpl ?? outboundFetch;
    const res = await f(`${this.c.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.c.apiKey}` }, signal: AbortSignal.timeout(this.c.timeoutMs ?? 8000),
      body: JSON.stringify({ model: this.c.model, temperature: 0, max_tokens: 400, response_format: { type: 'json_schema', json_schema: { name: 'summary', strict: true, schema: SUMMARY_SCHEMA } }, messages: [{ role: 'system', content: SUMMARY_SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify({ kind: i.kind, aggregates: i.payload, draft: i.rationale }) }] }),
    });
    if (!res.ok) throw new Error(`model HTTP ${res.status}`);
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return JSON.parse(j.choices?.[0]?.message?.content ?? '{}') as BilingualText;
  }
}

/** What a summary may contain. PURE. */
export function validateSummary(o: unknown): BilingualText | null {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  if (Object.keys(r).some((k) => k !== 'en' && k !== 'ar')) return null;
  for (const k of ['en', 'ar'] as const) {
    const v = r[k];
    if (typeof v !== 'string' || v.length < 5 || v.length > 400 || /https?:\/\/|www\./i.test(v) || healthWordIn(v) || detectPhi(v).length || checkAggregateOnly({ [k]: v }).length) return null;
  }
  return { en: r.en as string, ar: r.ar as string };
}

@Injectable()
export class AiSummaryService {
  private readonly log = new Logger('recommendation-summary');
  private override: SummaryModel | null = null;
  constructor(private readonly flags: FlagsService) {}
  /** Tests install a model (a hostile one, or a fake real one). Never used in production paths. */
  setOverride(m: SummaryModel | null) { this.override = m; }

  /** Which mode runs now: the requested one, or `mock` when a gate of `real` is missing. */
  async resolveMode(requested: SummaryMode, market: string): Promise<{ mode: SummaryMode; model: SummaryModel | null }> {
    if (requested === 'rules') return { mode: 'rules', model: null };
    if (this.override) return { mode: this.override.mode, model: this.override };
    if (requested === 'real') {
      const ai = await this.flags.evaluate(AI_RECOMMENDATIONS_FLAG, { market }).catch(() => ({ effective: false, reason: 'ERROR' as string }));
      const real = await this.flags.evaluate('growth.assistant_real_model', { market }).catch(() => ({ effective: false, reason: 'ERROR' as string }));
      const base = process.env.RECOMMENDATION_MODEL_BASE_URL; const model = process.env.RECOMMENDATION_MODEL; const key = process.env.RECOMMENDATION_MODEL_API_KEY;
      // an UNREGISTERED ai flag evaluates ON by the flag service rule; for a real model that is not enough: it must be registered (reason ON) and carry its gate evidence
      if (!(ai.effective && ai.reason === 'ON') || !(real.effective && real.reason === 'ON') || !base || !model || !key) { this.log.warn('real summary model requested but a gate is missing: using the mock summary'); return { mode: 'mock', model: new MockSummaryModel() }; }
      return { mode: 'real', model: new OpenAiCompatSummaryModel({ baseUrl: base, model, apiKey: key }) };
    }
    return { mode: 'mock', model: new MockSummaryModel() };
  }

  /** The summary of one proposal, or null (mode `rules`, a model failure, or an answer that fails validation). The aggregate-only assertion runs BEFORE the model is called. */
  async summarise(i: SummaryInput, requested: SummaryMode, market: string): Promise<Summary | null> {
    const { mode, model } = await this.resolveMode(requested, market);
    if (!model) return null;
    assertAggregateOnly({ kind: i.kind, payload: i.payload });
    try {
      const out = validateSummary(await model.summarise(i));
      if (!out) { this.log.warn(`summary from ${model.name} discarded by validation`); return null; }
      return { ...out, mode, label: 'AI-assisted', model: model.name };
    } catch (e) { this.log.warn(`summary model failed: ${(e as Error).message}`); return null; }
  }
}
