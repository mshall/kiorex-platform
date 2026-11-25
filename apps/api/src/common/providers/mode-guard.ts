/**
 * Real-mode approval guard (shared by every provider adapter: payments, messaging, push, ...). An adapter may run in REAL mode only when the approved record `INTEGRATION_MODES`
 * (maker-checker, Integrations Control Center, second super admin approves) says `real` for THAT integration. Anything else fails CLOSED with a NEEDS_HUMAN error: mock is always allowed.
 *
 * The approved record lives in the growth policy registry (a process-wide synchronous read, kept fresh by PolicyService); this module sits in `common` and cannot import it, so the
 * registry REGISTERS its reader here (`setApprovedModesSource`). No source registered (a bare unit test, a process that did not boot the policy module) = nothing approved = closed.
 *
 * Exemption for development and test stacks only: INTEGRATION_MODES_EXEMPT=true with NODE_ENV other than production. In production the flag is IGNORED (the guard stays closed) and
 * `modeGuardProblems()` reports it so startup refuses the deployment. An exemption is never a way to turn a real vendor on in production.
 */
type Env = Record<string, string | undefined>;
export type ApprovedModes = Partial<Record<string, 'mock' | 'real'>>;
let source: (() => ApprovedModes | null | undefined) | null = null;
export const setApprovedModesSource = (f: (() => ApprovedModes | null | undefined) | null) => { source = f; };

export class RealModeNotApprovedError extends Error {
  readonly code = 'REAL_MODE_NOT_APPROVED';
  constructor(public readonly integration: string, public readonly reason: string) {
    super(`NEEDS_HUMAN: ${integration} is configured for REAL mode but INTEGRATION_MODES does not approve real mode for it (${reason}). Propose the switch in the Integrations Control Center and have a second super admin approve it.`);
    this.name = 'RealModeNotApprovedError';
  }
}

export const modeGuardExempt = (env: Env = process.env): boolean => env.INTEGRATION_MODES_EXEMPT === 'true' && env.NODE_ENV !== 'production';

export function realModeDecision(integration: string, env: Env = process.env): { allowed: boolean; reason: string } {
  if (modeGuardExempt(env)) return { allowed: true, reason: 'exempt (INTEGRATION_MODES_EXEMPT, non-production)' };
  if (env.INTEGRATION_MODES_EXEMPT === 'true') return { allowed: false, reason: 'INTEGRATION_MODES_EXEMPT is ignored in production' };
  let modes: ApprovedModes | null | undefined;
  try { modes = source?.(); } catch { modes = null; }
  if (!modes) return { allowed: false, reason: 'the approved record is not available' };
  return modes[integration] === 'real' ? { allowed: true, reason: 'approved' } : { allowed: false, reason: `approved mode is ${modes[integration] ?? 'mock (never proposed)'}` };
}
export function assertRealModeApproved(integration: string, env: Env = process.env): void {
  const d = realModeDecision(integration, env);
  if (!d.allowed) throw new RealModeNotApprovedError(integration, d.reason);
}
/** Startup problems (names only): the exemption flag must never be present in production. */
export const modeGuardProblems = (env: Env = process.env): string[] => (env.INTEGRATION_MODES_EXEMPT === 'true' && env.NODE_ENV === 'production' ? ['INTEGRATION_MODES_EXEMPT must not be set in production (real mode needs an approved INTEGRATION_MODES record)'] : []);
