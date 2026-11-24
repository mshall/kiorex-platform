import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FRAUD_ACTIONS, FRAUD_RULE_IDS } from './signals';
import { FRAUD_RULES_DEFAULTS } from './fraud-config';

const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : e.name.endsWith('.ts') && !/\.spec\.ts$|fraud-public-test/.test(e.name) ? [join(d, e.name)] : []));
const FILES = files(__dirname); const text = (f: string) => readFileSync(f, 'utf8');
const imports = (s: string) => [...s.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);

/** GRW-P3-D: fraud never reaches attribution, commission, booking or provider standing; no PHI features; nothing paid out. */
describe('fraud package guards', () => {
  it('imports no attribution, booking, Pay, Clinic or provider-standing code (a decision, a commission or a booking cannot be changed from here)', () => {
    for (const f of FILES) for (const spec of imports(text(f))) expect({ f: f.replace(__dirname, ''), spec: /attribution\/(decide|attribution\.service)|(^|\/)booking(\/|\.|-growth|$)|(^|\/)pay(\/|$)|kiorly\.client|commission|moderation|provider-vendors/i.test(spec) ? spec : null }).toEqual({ f: f.replace(__dirname, ''), spec: null });
  });
  it('the code never writes to attribution, commission, booking or provider tables', () => {
    for (const f of FILES) expect(text(f)).not.toMatch(/growthAttributionDecision\.(create|update|delete|upsert)|bookingIntent\.(update|create|delete|upsert)|\.commission|provider\.(update|delete)/);
  });
  it('the action vocabulary is closed and every configured action is in it', () => {
    for (const per of Object.values(FRAUD_RULES_DEFAULTS().actions)) for (const a of Object.values(per)) expect(FRAUD_ACTIONS).toContain(a);
    expect(FRAUD_ACTIONS).toHaveLength(8);
  });
  it('no feature or rule mentions health data (specialty, diagnosis, prescription, visit reason, lab, pharmacy contents)', () => {
    for (const f of FILES.filter((x) => /(signals|features|rules\/)/.test(x))) expect(text(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')).not.toMatch(/specialty|diagnos|prescription|visitReason|symptom|medication/i);
  });
  it('every rule id of the plan exists and shadow is the shipped default', () => {
    expect(FRAUD_RULE_IDS).toHaveLength(11); expect(FRAUD_RULES_DEFAULTS().enforce).toBe(false);
    for (const r of Object.values(FRAUD_RULES_DEFAULTS().rules)) expect(r.enforce).toBe(false);
  });
  it('two-person on money cannot be switched off and the reversal goes through the P2-B2 service only', () => {
    expect(FRAUD_RULES_DEFAULTS().twoPersonOnMoney).toBe(true);
    const hold = text(join(__dirname, 'fraud-hold.service.ts')); expect(hold).toContain('RewardReversalService'); expect(hold).not.toMatch(/rewardLedgerEntry\.(create|update)|\$executeRaw/);
  });
});
