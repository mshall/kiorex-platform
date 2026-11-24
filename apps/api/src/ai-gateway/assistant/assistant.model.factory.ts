import { Injectable, Logger } from '@nestjs/common';
import { FlagsService } from '../../control-plane/control-plane-public';
import { ASSISTANT_FLAG } from './assistant.growth-bridge';
import type { AssistantPolicy } from './assistant.config';
import type { AssistantModel } from './assistant.types';
import { FixtureAssistantModel } from './model/fixture.model';
import { FallbackChain } from './model/fallback.chain';
import { MockAssistantModel } from './model/mock.model';
import { OpenAiCompatAssistantModel } from './model/openai-compat.model';

/**
 * Chooses the model chain for a turn. DEFAULT AND CI: the mock rules model. `fixture` replays a recorded JSONL. `real` is used ONLY when ALL of these hold: the policy says real, the locked flag
 * `growth.assistant_real_model` is effective (gate evidence), `ASSISTANT_BASE_URL` and `ASSISTANT_MODEL` are set and the key resolves from `ASSISTANT_API_KEY` (Secrets Manager, by secretRef, in AWS).
 * Anything missing fails CLOSED to the mock model. No paid vendor call exists without a human finishing every step (NEEDS_HUMAN).
 */
@Injectable()
export class AssistantModelFactory {
  private readonly log = new Logger('assistant-model-factory');
  private override: AssistantModel | null = null;
  private readonly chains = new Map<string, FallbackChain>();
  constructor(private readonly flags: FlagsService) {}

  /** Tests install a hostile or failing model here; pass null to clear. Never used in production code paths. */
  setOverride(m: AssistantModel | null) { this.override = m; this.chains.clear(); }

  async get(policy: AssistantPolicy, market: string): Promise<FallbackChain> {
    let mode = policy.model.mode;
    if (this.override) return this.chain('override', [this.override]);
    if (mode === 'real') {
      const flagOn = (await this.flags.evaluate(ASSISTANT_FLAG.REAL_MODEL, { market })).effective;
      const base = process.env.ASSISTANT_BASE_URL; const model = process.env.ASSISTANT_MODEL; const key = process.env.ASSISTANT_API_KEY;
      if (!flagOn || !base || !model || !key) { this.log.warn('real model requested but a gate is missing: using the mock model'); mode = 'mock'; }
      else return this.chain(`real:${model}`, [new OpenAiCompatAssistantModel({ baseUrl: base, model, apiKey: key })]);
    }
    if (mode === 'fixture' && process.env.ASSISTANT_FIXTURE_FILE) return this.chain(`fixture:${process.env.ASSISTANT_FIXTURE_FILE}`, [FixtureAssistantModel.fromFile(process.env.ASSISTANT_FIXTURE_FILE)]);
    return this.chain('mock', [new MockAssistantModel()]);
  }

  private chain(key: string, models: AssistantModel[]) {
    let c = this.chains.get(key);
    if (!c) { c = new FallbackChain(models); this.chains.set(key, c); }
    return c;
  }
}
