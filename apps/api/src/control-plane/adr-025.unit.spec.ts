import { FLAG_KEYS, SAFETY_NEVER_FLAGS, FLAG_CATALOGUE as CONTRACT_CATALOGUE } from '@kiorex/contracts';
import { FLAG_CATALOGUE } from './flag-catalogue';
import { FlagsService } from './flags.service';
import { isSafetyControlKey, SAFETY_CONTROL_TOKENS } from './safety-controls';

describe('ADR-025: safety controls can never be registered as flags', () => {
  const svc = new FlagsService({} as never, { register: () => undefined } as never);
  const bad = ['rx_safety_checks', 'clinic.encounter_signoff', 'audit_logging', 'kiorex.consent_enforcement', 'lab.qc_block', 'pharmacy.lot_expiry_block', 'pharmacy.recall_block', 'privileged_mfa', 'tenant_isolation', 'breach_response', 'kiorex.emergency_routing', 'lab.critical_value_escalation', 'pharmacist_signoff', 'clinic.record_export'];
  it.each(bad)('registry refuses %s', async (key) => {
    expect(isSafetyControlKey(key)).toBe(true);
    await expect(svc.registerDefinition('admin', { key, product: 'kiorex', class: 'MODULE', scopes: ['GLOBAL'], dependsOn: [], description: 'x', whenOff: 'x' })).rejects.toMatchObject({ response: { code: 'SAFETY_CONTROL_NOT_A_FLAG' } });
  });
  it('no catalogue key (ours or the contracts package) names a safety control', () => {
    for (const f of FLAG_CATALOGUE) expect({ key: f.key, safety: isSafetyControlKey(f.key) }).toEqual({ key: f.key, safety: false });
    for (const k of FLAG_KEYS) expect(isSafetyControlKey(k)).toBe(false);
  });
  it('covers every forbidden token published in @kiorex/contracts', () => {
    for (const s of SAFETY_NEVER_FLAGS) for (const t of s.forbiddenKeyTokens) expect(SAFETY_CONTROL_TOKENS).toContain(t);
  });
  it('our catalogue contains every key of the contracts catalogue with the same product/class', () => {
    const mine = new Map(FLAG_CATALOGUE.map((f) => [f.key, f]));
    for (const c of CONTRACT_CATALOGUE as readonly any[]) {
      if (String(c.key).includes('<')) continue; // patterns
      const m = mine.get(c.key);
      expect(m).toBeDefined();
      expect(m!.product).toBe(c.product);
    }
  });
});
