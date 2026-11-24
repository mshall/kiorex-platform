import { Logger } from '@nestjs/common';
import type { AssistantModel, ModelInput, ModelStep } from '../assistant.types';

export class ModelUnavailableError extends Error {}
export class ModelTimeoutError extends Error {}

interface Breaker { failures: number; openUntil: number }
export interface ChainOptions { timeoutMs?: number; failuresToOpen?: number; openMs?: number; now?: () => number }

/**
 * primary, then secondary models, each behind a circuit breaker and an 8 s timeout. When every model is open or failing the chain throws `ModelUnavailableError` and the router answers with the
 * deterministic booking machine (the last link of "primary, secondary, deterministic"), so a model outage never loses the conversation state.
 */
export class FallbackChain implements AssistantModel {
  private readonly log = new Logger('assistant-model');
  private readonly breakers = new Map<string, Breaker>();
  private last: AssistantModel | null = null;
  private readonly o: Required<ChainOptions>;
  constructor(private readonly models: AssistantModel[], o: ChainOptions = {}) { this.o = { timeoutMs: o.timeoutMs ?? 8000, failuresToOpen: o.failuresToOpen ?? 3, openMs: o.openMs ?? 60_000, now: o.now ?? Date.now }; }
  get name() { return this.models.map((m) => m.name).join('>'); }
  get mode() { return (this.last ?? this.models[0])?.mode ?? 'mock'; }
  lastUsage() { return this.last?.lastUsage?.() ?? { tokensIn: 0, tokensOut: 0, costMinor: 0 }; }
  breakerOpen(name: string) { const b = this.breakers.get(name); return !!b && b.openUntil > this.o.now(); }

  async step(i: ModelInput): Promise<ModelStep> {
    for (const m of this.models) {
      if (this.breakerOpen(m.name)) continue;
      try {
        const step = await this.withTimeout(m.step(i));
        this.breakers.delete(m.name); this.last = m;
        return step;
      } catch (e) {
        const b = this.breakers.get(m.name) ?? { failures: 0, openUntil: 0 };
        b.failures += 1;
        if (b.failures >= this.o.failuresToOpen) { b.openUntil = this.o.now() + this.o.openMs; b.failures = 0; this.log.warn(`model ${m.name} breaker open for ${this.o.openMs} ms`); }
        this.breakers.set(m.name, b);
        this.log.warn(`model ${m.name} failed: ${(e as Error).constructor.name}`); // never the message: it may echo input
      }
    }
    throw new ModelUnavailableError('no model available');
  }

  private withTimeout<T>(p: Promise<T>): Promise<T> {
    let t: NodeJS.Timeout;
    const timeout = new Promise<never>((_r, rej) => { t = setTimeout(() => rej(new ModelTimeoutError('model timeout')), this.o.timeoutMs); t.unref?.(); });
    return Promise.race([p, timeout]).finally(() => clearTimeout(t));
  }
}
