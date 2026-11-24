import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REWARD_ISSUE_ON } from '@kiorex/contracts';
import { validateGrowthConfig } from '../config/growth-config.service';
import { GROWTH_DEFAULT_PAYLOADS } from '../config/growth-defaults';

const SRC = join(__dirname, '..', '..');
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'generated' ? [] : walk(join(dir, e.name))) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
const prod = (dir: string) => walk(dir).filter((f) => !/\.(unit|int)\.spec\.ts$/.test(f));
const text = (f: string) => readFileSync(f, 'utf8');
const REWARD_FILES = prod(join(SRC, 'growth', 'rewards')); const REFERRAL_FILES = prod(join(SRC, 'growth', 'referral'));
const importsOf = (src: string) => [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
const SCHEMA = text(join(SRC, '..', 'prisma', 'schema.prisma'));
const model = (name: string) => SCHEMA.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? '';

/**
 * The safety rules S1 to S10 of the patient credit (ADR-048, KX-30 section 14) as repository guards. Each fails the build if code grows a path the founder decision forbids:
 * closed loop, no cash-out, no transfer, no top-up, never revenue, never mixed with the provider wallet. The database-level halves are asserted in growth-rewards.int.spec.ts.
 */
describe('patient credit safety rules S1 to S10 (repository guards)', () => {
  it('S1/S2/S7: the rewards and referral modules import no payout, PSP or Pay code (there is no path from the ledger to cash and no payment can create credit)', () => {
    for (const f of [...REWARD_FILES, ...REFERRAL_FILES]) for (const spec of importsOf(text(f))) {
      expect({ file: relative(SRC, f), spec: /(^|\/)pay(\/|$)|psp|payout|paymob|fawry|instapay/i.test(spec) ? spec : null }).toEqual({ file: relative(SRC, f), spec: null });
    }
  });
  it('S2: no route or handler of a rewards or referral controller is called withdraw, transfer, cashout, gift or send, and no DTO accepts a target subject, recipient or account', () => {
    for (const f of [...REWARD_FILES, ...REFERRAL_FILES].filter((x) => /controller\.ts$/.test(x))) {
      const t = text(f);
      const routes = [...t.matchAll(/@(?:Get|Post|Put|Patch|Delete)\(\s*['"]([^'"]*)['"]/g)].map((m) => m[1]);
      const handlers = [...t.matchAll(/^\s+(?:async\s+)?([a-zA-Z]+)\(@/gm)].map((m) => m[1]);
      for (const name of [...routes, ...handlers]) expect({ f: relative(SRC, f), name: /withdraw|transfer|cashout|cash-out|payout|gift|send|topup|top-up|load|convert/i.test(name) ? name : null }).toEqual({ f: relative(SRC, f), name: null });
      expect(t).not.toMatch(/\b(targetSub|toSub|recipient(Sub)?|destinationSub|beneficiary|iban|accountNumber|walletId)\b\s*[?!]?\s*:/);
    }
  });
  it('S2/S10: the patient endpoints of the ledger never take a subject: the caller is the verified session (no @Param/@Query/@Body named sub)', () => {
    for (const f of REWARD_FILES.filter((x) => /rewards\.controller\.ts$/.test(x)).concat(REFERRAL_FILES.filter((x) => /referral\.controller\.ts$/.test(x)))) expect(text(f)).not.toMatch(/@(Param|Query|Body)\(\s*['"]sub['"]/);
  });
  it('S3: every lot has an expiry (NOT NULL column, a CHECK) and the migrations keep the CHECK; the ledger table has no UPDATE path in code', () => {
    expect(model('RewardLot')).toMatch(/expiresAt\s+DateTime\s*\n/);
    const m = readdirSync(join(SRC, '..', 'prisma', 'migrations')).filter((d) => /growth_p2/.test(d)).map((d) => text(join(SRC, '..', 'prisma', 'migrations', d, 'migration.sql'))).join('\n');
    expect(m).toContain('RewardLot_expiry_required_check'); expect(m).toContain('reward_ledger_immutable');
    for (const f of REWARD_FILES) expect({ f: relative(SRC, f), upd: /rewardLedgerEntry\.(update|updateMany|delete|deleteMany|upsert)\b/.test(text(f)) }).toEqual({ f: relative(SRC, f), upd: false });
  });
  it('S4: the issue triggers accept only verified events: SIGNUP and BOOKING_CREATED are not valid `issueOn` values, in the contract list and in the config validator', () => {
    expect([...REWARD_ISSUE_ON]).toEqual(['COMPLETED_VISIT', 'COMPLETED_NTH_VISIT', 'SUPPORT_APPROVED', 'REFUND_CHOICE']);
    for (const bad of ['SIGNUP', 'BOOKING_CREATED', 'APP_INSTALL', 'BOOKING_HELD']) {
      const v = validateGrowthConfig('REWARD_RULES', { ...(GROWTH_DEFAULT_PAYLOADS.REWARD_RULES as object), issueOn: [bad] });
      expect(v.valid).toBe(false);
    }
    expect(validateGrowthConfig('REWARD_RULES', GROWTH_DEFAULT_PAYLOADS.REWARD_RULES as object).valid).toBe(true);
  });
  it('S6: no revenue, commission or analytics-revenue code reads a reward table (rewards are never Kiorex revenue)', () => {
    const revenueFiles = [...prod(SRC)].filter((x) => /revenue|commission/i.test(relative(SRC, x)) && !/rewards\//.test(x)); // the reward COST (issued, redeemed) may feed blended CAC (P2-F); a revenue or commission query may not read it
    expect(revenueFiles.length).toBeGreaterThan(0);
    for (const f of [...revenueFiles, ...prod(join(SRC, 'pay')).filter((x) => /ledger\.ts$/.test(x))]) expect({ f: relative(SRC, f), reads: /rewardLot|rewardLedgerEntry|RewardLot|RewardLedgerEntry/.test(text(f)) }).toEqual({ f: relative(SRC, f), reads: false });
  });
  it('S7: no code path creates a lot from a payment capture: the only ISSUE linked to the Pay module is a REFUND_CREDIT with a refund id', () => {
    const payTxt = prod(join(SRC, 'pay')).map(text).join('\n');
    expect(payTxt).not.toMatch(/rewardLot\.create|issuance\.issue\(|rewards\.issue\(/); // Pay reaches the ledger only through the REWARDS_PORT methods
    expect(text(join(SRC, 'growth', 'rewards', 'rewards-port.service.ts'))).toMatch(/kind: 'REFUND_CREDIT'/);
    for (const f of REWARD_FILES) for (const m of text(f).matchAll(/kind:\s*'(TOPUP|LOAD|DEPOSIT_CREDIT|WALLET)'/g)) throw new Error(`${f}: ${m[0]}`);
  });
  it('S8: the only way value leaves the module is the patient\'s own screen and the refund-to-original job: no exporter, no webhook, no ad platform in the rewards and referral code', () => {
    for (const f of [...REWARD_FILES, ...REFERRAL_FILES]) expect({ f: relative(SRC, f), net: /fetch\(|axios|https?\.request|outbound-http|adapters\/growth|googleads|metaads|tiktok/i.test(text(f)) }).toEqual({ f: relative(SRC, f), net: false });
  });
  it('S9: the per-booking maximum is min(available, share of the amount, amount minus the card minimum) in one place and the card keeps at least one minor unit', () => {
    expect(text(join(SRC, 'growth', 'rewards', 'reward-math.ts'))).toMatch(/Math\.max\(i\.minPayableMinor, 1\)/);
    expect(text(join(SRC, 'growth', 'rewards', 'checkout-lines.ts'))).toMatch(/Math\.max\(i\.minCardMinor \?\? 0, 1\)/);
  });
  // reward-reconcile.job.ts is the one file that names the provider-wallet words, in order to DETECT them (RC-5)
  it('S10: no provider-wallet word in the patient ledger: no tenant column on a reward table, no Clinic credit import, no shared balance row', () => {
    for (const name of ['RewardLot', 'RewardLedgerEntry', 'RewardHousehold', 'RewardHouseholdMember', 'RefundDestinationChoice', 'GoodwillGrant', 'RewardCheckoutLine', 'RewardApprovalRequest', 'RewardRecoverableLoss']) expect({ name, tenant: /\b(tenantId|walletId|providerCredit|clinicCredit|orgId)\b/.test(model(name)) }).toEqual({ name, tenant: false });
    for (const f of [...REWARD_FILES, ...REFERRAL_FILES].filter((x) => !/reward-reconcile\.job\.ts$/.test(x))) expect({ f: relative(SRC, f), wallet: /CreditLedgerEntry|CreditWallet|credits\/|provider[-_ ]?credit|clinic[-_ ]?credit/i.test(text(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')) }).toEqual({ f: relative(SRC, f), wallet: false });
  });
  it('the referral and reward modules read no health data: no specialty, diagnosis, medication, lab or visit-reason word is stored or sent (scope only names closed service kinds)', () => {
    for (const f of [...REWARD_FILES, ...REFERRAL_FILES]) { const t = text(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''); expect({ f: relative(SRC, f), phi: /\b(diagnos|prescription|medication|symptom|complaint|visitReason|icd10)\w*/i.test(t) }).toEqual({ f: relative(SRC, f), phi: false }); }
  });
});
