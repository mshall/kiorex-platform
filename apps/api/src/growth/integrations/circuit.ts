import { policyNow } from '../policy/policy-registry';
/** Pure circuit-breaker state machine (GRW-P2-F). OPEN after `threshold` consecutive failures, HALF_OPEN after the cool-down (one probe), CLOSED on success. */
export type Circuit = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export const BREAKER_THRESHOLD = 5; // defaults; the live values are breakerThreshold() and breakerCooldownMs() (INTEGRATION_RUNTIME)
export const BREAKER_COOLDOWN_MS = 30 * 60_000;
export const breakerThreshold = (): number => policyNow<{ breakerThreshold: number }>('INTEGRATION_RUNTIME').breakerThreshold;
export const breakerCooldownMs = (): number => policyNow<{ breakerCooldownMinutes: number }>('INTEGRATION_RUNTIME').breakerCooldownMinutes * 60_000;
export const maxRunAttempts = (): number => policyNow<{ maxAttempts: number }>('INTEGRATION_RUNTIME').maxAttempts;

export interface BreakerState { circuit: Circuit; consecutiveFailures: number; lastErrorAt: Date | null }

/** May a run start now? An OPEN breaker allows a single probe once the cool-down has passed. */
export function allowRun(s: BreakerState, now: Date, cooldownMs = breakerCooldownMs()): { allowed: boolean; next: Circuit } {
  if (s.circuit === 'CLOSED') return { allowed: true, next: 'CLOSED' };
  if (s.circuit === 'HALF_OPEN') return { allowed: true, next: 'HALF_OPEN' };
  return s.lastErrorAt && now.getTime() - s.lastErrorAt.getTime() >= cooldownMs ? { allowed: true, next: 'HALF_OPEN' } : { allowed: false, next: 'OPEN' };
}
export function afterRun(s: BreakerState, ok: boolean, now: Date, threshold = breakerThreshold()): BreakerState {
  if (ok) return { circuit: 'CLOSED', consecutiveFailures: 0, lastErrorAt: s.lastErrorAt };
  const n = s.consecutiveFailures + 1;
  return { circuit: s.circuit === 'HALF_OPEN' || n >= threshold ? 'OPEN' : s.circuit, consecutiveFailures: n, lastErrorAt: now };
}
/** Retry delay with full jitter: random in [0, min(cap, base * 2^attempt)]. `rand` is injected so the unit test is deterministic. */
export const backoffMs = (attempt: number, rand: () => number = Math.random, base = 500, cap = 30_000) => Math.floor(rand() * Math.min(cap, base * 2 ** attempt));
