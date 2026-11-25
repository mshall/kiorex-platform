import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FLAG_CATALOGUE } from '../../control-plane/control-plane-public';
import { LOYALTY_FLAG } from '../growth-flags';

const DIR = __dirname;
const sources = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts')).map((f) => ({ f, s: readFileSync(join(DIR, f), 'utf8') }));
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Points are not money (founder rule for GRW-P4-D). Static guards over the source of the folder and the schema. */
describe('loyalty separation guards (GRW-P4-D)', () => {
  it('only the redemption adapter touches the patient reward ledger; nothing else imports rewards, pay or the Clinic client', () => {
    for (const { f, s } of sources) {
      const code = strip(s);
      if (f !== 'loyalty-redemption.adapter.ts') expect(code).not.toMatch(/from '\.\.\/rewards\/|rewardLot|rewardLedgerEntry/);
      expect(code).not.toMatch(/from '\.\.\/\.\.\/pay\/|from '\.\.\/\.\.\/kiorly\/|providerCredit|creditLedger|\/credits\//);
    }
  });
  it('the adapter issues exactly two kinds of lot, both marketing-funded, and never writes the ledger itself', () => {
    const code = strip(sources.find((x) => x.f === 'loyalty-redemption.adapter.ts')!.s);
    expect([...code.matchAll(/kind: '([A-Z_]+)'/g)].map((m) => m[1]).sort()).toEqual(['LOYALTY', 'PROMO']);
    expect([...code.matchAll(/funding: '([A-Z_]+)'/g)].map((m) => m[1])).toEqual(['PLATFORM_MARKETING', 'PLATFORM_MARKETING']);
    expect(code).not.toMatch(/\.create\(|\.update\(|\$executeRaw|ledger\.append/);
  });
  it('no route or method is a wallet verb: no top-up, transfer, gift, withdraw, cash-out, send-money, buy or sell', () => {
    for (const { f, s } of sources.filter((x) => /controller|service|job|adapter/.test(x.f))) {
      const routes = [...strip(s).matchAll(/@(Get|Post|Put|Delete|Patch)\('([^']*)'\)/g)].map((m) => m[2]).join(' ');
      expect(routes).not.toMatch(/top-?up|transfer|gift|withdraw|cash-?out|wallet|send-?money|sell|buy|payout/i);
      expect(strip(s)).not.toMatch(/\b(topUp|transferTo|transferPoints|giftTo|giftPoints|withdraw|cashOut|sellPoints|buyPoints|walletBalance|payout)\b/);
    }
  });
  it('the patient controller exposes exactly me, history, convert and the partner redeem', () => {
    const code = strip(sources.find((x) => x.f === 'loyalty-public.controller.ts')!.s);
    expect([...code.matchAll(/@(Get|Post|Put|Delete|Patch)\('([^']*)'\)/g)].map((m) => `${m[1]} ${m[2]}`)).toEqual(['Get me', 'Get history', 'Post convert', 'Post partner/redeem']);
    expect(code).toContain('@RequiresFlag(LOYALTY_FLAG)');
  });
  it('the ops reads select no booking, provider, specialty, doctor or person and never an identifier of a patient', () => {
    for (const f of ['loyalty-admin.service.ts', 'loyalty-admin.controller.ts']) expect(strip(sources.find((x) => x.f === f)!.s)).not.toMatch(/bookingIntent|appointment|specialt|clinician|diagnos|prescription|where: \{[^}]*\bsub\b/i);
  });
  it('the schema ledger entry has no cash, balance-of-money or transfer column and the ledger types are the five contract values', () => {
    const schema = readFileSync(join(DIR, '../../../prisma/schema.prisma'), 'utf8');
    for (const m of ['LoyaltyAccount', 'LoyaltyAccrualEntry', 'PartnershipProgram', 'PartnershipCode', 'PartnershipCodeRedemption']) {
      const body = new RegExp(`model ${m} \\{([\\s\\S]*?)\\n\\}`).exec(schema)?.[1] ?? '';
      expect(body.length).toBeGreaterThan(20); expect(body.replace(/\/\/\/.*$/gm, '')).not.toMatch(/^\s*(cash|wallet|transferTo|recipient|giftTo|withdraw)\w*\s/im);
    }
    expect(/type\s+String \/\/ ([A-Z_ ]+)/.exec(/model LoyaltyAccrualEntry \{[\s\S]*?\n\}/.exec(schema)![0])![1].trim().split(' ').sort()).toEqual(['ACCRUE', 'CONVERT', 'EXPIRE', 'REVERSE', 'TIER_BONUS']);
  });
  it('the flag is mirrored in the Kiorex catalogue as launch-locked with a whenOff text and depends on rewards', () => {
    const f = FLAG_CATALOGUE.find((x) => x.key === LOYALTY_FLAG)!;
    expect(f).toBeDefined(); expect(f.launchLocked).toBe(true); expect(f.whenOff.length).toBeGreaterThan(20); expect(f.product).toBe('kiorex'); expect(f.dependsOn).toContain('growth.rewards'); expect(f.gateHint ?? '').toContain('NEEDS_HUMAN');
  });
  it('the module sends no message: no messaging, push, sms, whatsapp or e-mail import', () => {
    for (const { s } of sources) expect(strip(s)).not.toMatch(/messaging|sendMessage|whatsapp|sms|pushNotification|mailer/i);
  });
});
