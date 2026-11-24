import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FLAG_CATALOGUE } from '../../control-plane/control-plane-public';
import { CORPORATE_FLAG } from '../growth-flags';

const DIR = __dirname;
const sources = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts')).map((f) => ({ f, s: readFileSync(join(DIR, f), 'utf8') }));
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The corporate programme must stay a separate ledger with no money-wallet behaviour (founder rule for GRW-P4-C). These are static guards over the source of the folder. */
describe('corporate separation guards (GRW-P4-C)', () => {
  it('never reads or writes the patient credit tables, the sponsored-promotion tables or any Clinic credit', () => {
    for (const { f, s } of sources) expect(strip(s)).not.toMatch(/rewardLot|rewardLedgerEntry|RewardLot|RewardLedgerEntry|rewardHousehold|goodwillGrant|bookingSponsoredDiscount|sponsoredPromotion|providerCredit|creditLedger|\/credits\//);
  });
  it('the module imports nothing from rewards, promotions, pay or the Clinic client', () => {
    for (const { f, s } of sources) expect(strip(s)).not.toMatch(/from '\.\.\/(rewards|promotions|referral)\/|from '\.\.\/\.\.\/pay\/|from '\.\.\/\.\.\/kiorly\//);
  });
  it('has no wallet verbs on any route or method: no top-up, transfer, gift, withdraw, cash-out, balance or send-money', () => {
    for (const { f, s } of sources.filter((x) => /controller|service|job/.test(x.f))) {
      const routes = [...strip(s).matchAll(/@(Get|Post|Put|Delete|Patch)\('([^']*)'\)/g)].map((m) => m[2]).join(' ');
      expect(routes).not.toMatch(/top-?up|transfer|gift|withdraw|cash-?out|balance|wallet|send-?money|convert/i);
      expect(strip(s)).not.toMatch(/\b(topUp|transferTo|giftTo|withdraw|cashOut|walletBalance)\b/);
    }
  });
  it('the schema holds no balance column on any corporate model', () => {
    const schema = readFileSync(join(DIR, '../../../prisma/schema.prisma'), 'utf8');
    for (const m of ['CorporateAccount', 'CorporateCode', 'CorporateMember', 'CorporateBenefitEntry', 'CorporateHrBatch', 'CorporateHrEntry', 'CorporateLead', 'CorporateLeadHistory', 'CorporateInvoiceNote']) {
      const body = new RegExp(`model ${m} \\{([\\s\\S]*?)\\n\\}`).exec(schema)?.[1] ?? '';
      expect(body.length).toBeGreaterThan(20);
      expect(body.replace(/\/\/\/.*$/gm, '')).not.toMatch(/^\s*(balance|availableMinor|remainingMinor|walletMinor|storedValue)\b/im);
    }
  });
  it('the report and the lead service select no booking, provider, specialty, doctor or clinic data', () => {
    for (const f of ['corporate-report.service.ts', 'b2b-referral.service.ts', 'corporate-admin.controller.ts']) expect(strip(sources.find((x) => x.f === f)!.s)).not.toMatch(/bookingIntent|provider(?!Ref)|specialt|clinician|diagnos|appointment|prescription/i);
  });
  it('the flag is mirrored in the Kiorex catalogue as launch-locked with a whenOff text', () => {
    const f = FLAG_CATALOGUE.find((x) => x.key === CORPORATE_FLAG)!;
    expect(f).toBeDefined(); expect(f.launchLocked).toBe(true); expect(f.whenOff.length).toBeGreaterThan(20); expect(f.product).toBe('kiorex');
  });
});
