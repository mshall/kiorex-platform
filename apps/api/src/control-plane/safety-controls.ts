import { SAFETY_NEVER_FLAGS } from '@kiorex/contracts';

/**
 * ADR-025 / KX-08 §09 RULE: these are NOT flags — never switchable. The registry refuses any key naming one of them.
 * Union of the contracts package token list and Kiorex-local tokens.
 */
const LOCAL_TOKENS = ['emergency_routing', 'emergency.routing', 'emergency_detection', 'consent_enforcement', 'tenant_isolation', 'breach_response', 'privileged_mfa', 'pharmacist_signoff'];
export const SAFETY_CONTROL_TOKENS: string[] = [...new Set([...SAFETY_NEVER_FLAGS.flatMap((s) => [...s.forbiddenKeyTokens]), ...LOCAL_TOKENS])];

export function isSafetyControlKey(key: string): boolean {
  const k = key.toLowerCase();
  return SAFETY_CONTROL_TOKENS.some((t) => k.includes(t));
}
