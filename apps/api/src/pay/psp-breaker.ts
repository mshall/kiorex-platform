import { ProviderError } from '../common/providers/http';

/**
 * Per-PSP circuit breaker (PAY-READY). In-process by design: it protects THIS instance's threads and the patient from a hung gateway; it holds no money state.
 * CLOSED -> OPEN after `threshold` consecutive TRANSIENT failures (network, timeout, 429, 5xx); a request is then refused instantly (PSP_CIRCUIT_OPEN) until `cooldownMs`
 * passes, when ONE probe is let through (HALF_OPEN): success closes the circuit, failure re-opens it. A rejected request (4xx: bad request, unauthorised) is the caller's or the
 * configuration's fault, not an outage, and never counts. The clock is injected so tests are deterministic.
 */
export class PspCircuitOpenError extends Error {
  readonly code = 'PSP_CIRCUIT_OPEN';
  constructor(public readonly psp: string, public readonly retryAfterMs: number) { super(`PSP_CIRCUIT_OPEN:${psp}`); this.name = 'PspCircuitOpenError'; }
}
export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export interface BreakerOptions { threshold: number; cooldownMs: number; now?: () => number }
export const isTransient = (e: unknown): boolean => e instanceof ProviderError ? e.retryable : !(e instanceof PspCircuitOpenError) && !(e instanceof Error && /NEEDS_HUMAN|not configured/i.test(e.message));

export class PspBreaker {
  private failures = 0; private openedAt = 0; private state: BreakerState = 'CLOSED'; private probing = false;
  constructor(public readonly name: string, private opts: BreakerOptions) {}
  configure(o: Partial<BreakerOptions>) { this.opts = { ...this.opts, ...o }; }
  private now() { return (this.opts.now ?? Date.now)(); }
  snapshot() { return { state: this.state, consecutiveFailures: this.failures, openedAt: this.openedAt ? new Date(this.openedAt).toISOString() : null }; }
  reset() { this.failures = 0; this.openedAt = 0; this.state = 'CLOSED'; this.probing = false; }
  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      const waited = this.now() - this.openedAt;
      if (waited < this.opts.cooldownMs) throw new PspCircuitOpenError(this.name, this.opts.cooldownMs - waited);
      this.state = 'HALF_OPEN'; this.probing = false;
    }
    if (this.state === 'HALF_OPEN') {
      if (this.probing) throw new PspCircuitOpenError(this.name, this.opts.cooldownMs);
      this.probing = true;
    }
    try {
      const r = await fn();
      this.failures = 0; this.state = 'CLOSED'; this.probing = false;
      return r;
    } catch (e) {
      this.probing = false;
      if (isTransient(e)) {
        this.failures += 1;
        if (this.state === 'HALF_OPEN' || this.failures >= this.opts.threshold) { this.state = 'OPEN'; this.openedAt = this.now(); }
      } else if (this.state === 'HALF_OPEN') this.state = 'CLOSED'; // the gateway answered (with a rejection): it is up
      throw e;
    }
  }
}

const registry = new Map<string, PspBreaker>();
export function breakerFor(psp: string, o: BreakerOptions): PspBreaker {
  let b = registry.get(psp);
  if (!b) { b = new PspBreaker(psp, o); registry.set(psp, b); } else b.configure({ threshold: o.threshold, cooldownMs: o.cooldownMs });
  return b;
}
export const breakerSnapshots = () => Object.fromEntries([...registry].map(([k, b]) => [k, b.snapshot()]));
export const resetBreakers = () => registry.clear();
