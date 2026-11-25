/**
 * Real-mode approval gate (launch guide 13.4). `<KIND>_MODE=real` in the environment is NOT enough: an adapter may run against a real vendor only when the maker-checker record
 * `INTEGRATION_MODES` (Integrations Control Center, second super admin) approves `real` for that integration. Mock is always allowed. Otherwise the adapter fails CLOSED with a
 * NEEDS_HUMAN error and sends nothing.
 *
 * Where the approved record comes from: the growth module registers a synchronous reader at start (`setApprovedModesSource`); this file imports nothing from it (module boundaries).
 * No source registered (growth not loaded) means nothing is approved.
 *
 * Dev and test exemption: ONLY the explicit flag `INTEGRATION_MODE_GATE_BYPASS=true`, and ONLY when NODE_ENV is not `production` (the flag is ignored there and `bypassProblem` makes
 * startup checks report it). Shared by messaging and payments: keys are the Integrations Control Center keys (SMS, EMAIL, WHATSAPP_CLOUD, PUSH_FCM, PUSH_APNS, PUSH_EXPO, PAYMOB, FAWRY, INSTAPAY ...).
 */
type Env = Record<string, string | undefined>;
export type ApprovedModes = Record<string, 'mock' | 'real' | undefined>;
let source: (() => ApprovedModes | undefined) | undefined;
export const setApprovedModesSource = (fn: (() => ApprovedModes | undefined) | undefined): void => { source = fn; };

export const GATE_BYPASS_FLAG = 'INTEGRATION_MODE_GATE_BYPASS';
const isProd = (env: Env) => env.NODE_ENV === 'production';
const bypassOn = (env: Env) => env[GATE_BYPASS_FLAG] === 'true' && !isProd(env);

/** A startup / status problem when the bypass flag is set where it must not be. */
export const bypassProblem = (env: Env = process.env): string | null => (env[GATE_BYPASS_FLAG] === 'true' && isProd(env) ? `${GATE_BYPASS_FLAG} is not allowed in production (ignored)` : null);

export interface GateDecision { allowed: boolean; reason?: string }
export function realModeGate(key: string, env: Env = process.env): GateDecision {
  if (bypassOn(env)) return { allowed: true };
  let approved: ApprovedModes | undefined;
  try { approved = source?.(); } catch { approved = undefined; }
  if (approved?.[key] === 'real') return { allowed: true };
  return { allowed: false, reason: `NEEDS_HUMAN: ${key} real mode is not approved (INTEGRATION_MODES). Propose real mode in the Integrations Control Center and have a second super admin approve it; see Docs/INTEGRATION_RUNBOOK_MESSAGING.md` };
}
/** Short stable code stored on the message row. */
export const gateErrorCode = (key: string) => `NEEDS_HUMAN_REAL_MODE_NOT_APPROVED:${key}`;
