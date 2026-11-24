import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateGrowthConfig as contractValidate, GROWTH_CONFIG_SCHEMAS } from '@kiorex/contracts';
import { validateMarketProfile } from '../../market/market-core-public';
import { validateGrowthConfig } from '../config/growth-config.service';
import { buildBundle } from './config-bundle';
import { EMBEDDED_DATA_CELLS, loadDataCells } from './data-cells';
import { decodeCsv, parseGeography, readCsv } from './geography-csv';
import { validateStep } from './onboarding-steps';
import { readiness } from './readiness';

const identity = { name: { ar: 'زد واي', en: 'Zeta Yankee' }, currency: 'JOD', minorUnits: 3, phoneCode: '+962', timezone: 'Asia/Amman', locales: ['ar', 'en'], defaultLocale: 'ar', quietHours: { start: '22:00', end: '08:00' }, workingWeek: [0, 1, 2, 3, 4] };
const regulation = { marketingLicenceRequired: true, marketingLicenceHeld: false, consentRegimeId: 'zy-regime-v0', minimumAge: 18, healthAdvertisingRestricted: true, reviewMarkupAllowed: false, dataExportRuleId: 'zy-export-v0' };
const steps = { identity, regulation, consent: { textVersionIds: { analytics: 'TODO_NEEDS_HUMAN_v0', marketing: 'TODO_NEEDS_HUMAN_v0' }, maxMarketingPerDay: 1, maxMarketingPerWeek: 3 }, residency: { dataCellId: 'frankfurt' }, geography: { count: 4 }, specialties: { enabled: [{ code: 'dermatology', nameAr: 'a', nameEn: 'b' }] }, providers: { importBatchId: 'b1' }, integrations: { whatsappPhoneNumberIdRef: null } };
const H = 'level,key,parentKey,nameAr,nameEn,slugAr,slugEn';

describe('config bundle (GC: output validates against every schema)', () => {
  it('MARKET_GROWTH and CONSENT_DEFAULTS validate against the CONTRACT JSON Schemas, MARKET_PROFILE against its validator, with no EG default leaking into ZY', () => {
    const b = buildBundle('ZY', steps);
    expect(contractValidate('MARKET_GROWTH', b.MARKET_GROWTH)).toMatchObject({ valid: true }); expect(contractValidate('CONSENT_DEFAULTS', b.CONSENT_DEFAULTS)).toMatchObject({ valid: true });
    expect(validateMarketProfile(b.MARKET_PROFILE)).toEqual([]); expect(validateGrowthConfig('MARKET_PROFILE', b.MARKET_PROFILE)).toMatchObject({ valid: true });
    expect(b.MARKET_GROWTH).toMatchObject({ market: 'ZY', currency: 'JOD', phoneCode: '+962', canonicalSegment: 'zy', dataCell: 'frankfurt', marketingLicenceConfirmed: false });
    expect(b.CONSENT_DEFAULTS).toMatchObject({ regimeId: 'zy-regime-v0', quietHoursTimezone: 'Asia/Amman', quietHoursStart: '22:00' });
    expect(JSON.stringify(b)).not.toMatch(/Africa\/Cairo|EGP|pdpl-eg|"\+20"/);
    expect(Object.keys(GROWTH_CONFIG_SCHEMAS)).toEqual(expect.arrayContaining(['MARKET_GROWTH', 'CONSENT_DEFAULTS']));
  });
  it('the profile validator rejects unknown keys, a currency in lower case, a wrong canonical segment and a licence held without being required', () => {
    const p = buildBundle('ZY', steps).MARKET_PROFILE as Record<string, unknown>;
    expect(validateMarketProfile({ ...p, extra: 1 })[0]).toMatch(/not a known key/); expect(validateMarketProfile({ ...p, currency: 'jod' }).length).toBe(1);
    expect(validateMarketProfile({ ...p, canonicalSegment: 'eg' })[0]).toMatch(/canonicalSegment/); expect(validateMarketProfile({ ...p, regulation: { ...(p.regulation as object), marketingLicenceRequired: false, marketingLicenceHeld: true } })[0]).toMatch(/needs marketingLicenceRequired/);
    expect(validateMarketProfile({ ...p, geographyRef: 'Market-Geography/ZY' })[0]).toMatch(/lower-case/); expect(validateMarketProfile('x')).toEqual(['/ must be an object']);
  });
});

describe('wizard step validators', () => {
  it('accept the ZY answers and reject each class of mistake with a path', () => {
    for (const [s, p] of [['identity', identity], ['regulation', regulation], ['consent', steps.consent], ['residency', steps.residency], ['providers', steps.providers], ['specialties', steps.specialties], ['integrations', steps.integrations]] as const) expect(validateStep(s, p)).toEqual([]);
    expect(validateStep('identity', { ...identity, timezone: 'Nowhere/Land' })[0]).toMatch(/timezone/); expect(validateStep('identity', { ...identity, name: { ar: 'x‮y', en: 'x' } })[0]).toMatch(/direction overrides/);
    expect(validateStep('consent', { ...steps.consent, maxMarketingPerDay: 5, maxMarketingPerWeek: 2 })[0]).toMatch(/cannot exceed/); expect(validateStep('residency', { dataCellId: 'mars' })[0]).toMatch(/unknown cell is refused/);
    expect(validateStep('specialties', { enabled: [{ code: 'dermatology', nameAr: 'a', nameEn: 'b' }, { code: 'dermatology', nameAr: 'a', nameEn: 'b' }] })[0]).toMatch(/twice/); expect(validateStep('integrations', { whatsappPhoneNumberIdRef: 'ABC DEF' })[0]).toMatch(/reference name/);
    expect(validateStep('geography', {})[0]).toMatch(/only by the CSV import/); expect(validateStep('identity', [])[0]).toMatch(/must be an object/);
  });
  it('legal texts, prices and fees have no field anywhere in the answers', () => {
    const all = JSON.stringify(buildBundle('ZY', steps)); expect(all).not.toMatch(/price|fee|vat|tax|privacyNotice|terms/i);
  });
});

describe('geography CSV', () => {
  const rows = (...r: string[]) => [H, ...r].join('\n');
  it('derives keys and slugs, accepts BOM, semicolons and tabs, and counts levels', () => {
    const p = parseGeography(rows('CITY,,,عمّان,Amman Capital,,', 'DISTRICT,,amman-capital,عبدون,Abdoun,,'));
    expect(p.errors).toEqual([]); expect(p.rows.map((r) => [r.level, r.key, r.parentKey, r.slugEn])).toEqual([['CITY', 'amman-capital', '', 'amman-capital'], ['DISTRICT', 'abdoun', 'amman-capital', 'abdoun']]);
    expect(parseGeography(rows('CITY,a1,,ع,A,aaa,aaa').replace(/,/g, ';')).cities).toBe(1); expect(parseGeography(rows('CITY,a1,,ع,A,aaa,aaa').replace(/,/g, '\t')).cities).toBe(1);
    const d = decodeCsv({ text: `﻿${rows('CITY,a1,,ع,A,aaa,aaa')}` }); expect('text' in d && d.text.startsWith('level')).toBe(true);
  });
  it('quoted cells with commas and embedded newlines read as one cell', () => { expect(readCsv('a,b\n"x, y","l1\nl2"')).toEqual([['a', 'b'], ['x, y', 'l1\nl2']]); });
  it('names every class of error with its line and imports nothing when there is one', () => {
    const code = (r: string) => parseGeography(rows(r)).errors[0]?.code;
    expect(code('CITY,a1,,ع,A‏b,aaa,aaa')).toBe('BAD_CHARACTER'); expect(code('CITY,a1,,@cmd,A,aaa,aaa')).toBe('FORMULA'); expect(code('CITY,a1,,ع,A,A B,aaa')).toBe('SLUG'); expect(code('CITY,A1,,ع,A,aaa,aaa')).toBe('KEY'); expect(code('CITY,a1,x,ع,A,aaa,aaa')).toBe('PARENT'); expect(code('DISTRICT,a1,,ع,A,aaa,aaa')).toBe('PARENT');
    const bad = parseGeography(rows('CITY,a1,,ع,A,aaa,aaa', 'CITY,a2,,ب,B,aaa,bbb')); expect(bad.errors[0]).toMatchObject({ line: 3, code: 'DUPLICATE_SLUG' }); expect(bad.rows).toEqual([]);
    expect(parseGeography('').errors[0]!.code).toBe('EMPTY');
  });
  it('a slug may repeat across levels but never within one', () => { expect(parseGeography(rows('CITY,a1,,ع,A,aaa,aaa', 'DISTRICT,a2,a1,ب,B,aaa,aaa')).errors).toEqual([]); });
  it('windows-1256 bytes decode when declared and are refused as UTF-8', () => {
    const buf = Buffer.from([0xDA, 0xE3, 0xC7, 0xE4]); const ok = decodeCsv({ base64: buf.toString('base64'), encoding: 'windows-1256' });
    expect('text' in ok && ok.text).toBe('عمان'); expect('error' in decodeCsv({ base64: buf.toString('base64') })).toBe(true); expect('error' in decodeCsv({ text: 'a�b' })).toBe(true);
  });
  it('error list is capped at 200 and says so', () => { const many = rows(...Array.from({ length: 500 }, () => 'TOWN,a,,ع,A,aaa,aaa')); const p = parseGeography(many); expect(p.errors.length).toBe(200); expect(p.truncatedErrors).toBe(true); });
});

describe('readiness checklist', () => {
  const base = { steps: steps as never, geography: { cities: 2, districts: 2 }, versions: {}, flagDefined: false, live: false, sameCellMarkets: ['EG'] };
  it('statuses: TODO is something the console can do; NEEDS_HUMAN is never closed by code; ready means no TODO is left, not live', () => {
    const r = readiness(base); const s = (id: string) => r.items.find((i) => i.id === id)!.status;
    expect(s('identity')).toBe('DONE'); expect(s('configVersions')).toBe('TODO'); expect(s('flagDefinition')).toBe('TODO'); expect(s('marketingLicence')).toBe('NEEDS_HUMAN'); expect(s('consentTexts')).toBe('NEEDS_HUMAN'); expect(s('legalTexts')).toBe('NEEDS_HUMAN'); expect(s('launchGate')).toBe('NEEDS_HUMAN');
    expect(r.ready).toBe(false); expect(r.live).toBe(false);
    const done = readiness({ ...base, versions: { MARKET_PROFILE: 'ACTIVE', MARKET_GROWTH: 'ACTIVE', CONSENT_DEFAULTS: 'ACTIVE' }, flagDefined: true }); expect(done.ready).toBe(true); expect(done.live).toBe(false); expect(done.needsHuman).toBeGreaterThanOrEqual(3);
    expect(readiness({ ...base, versions: { MARKET_PROFILE: 'PENDING_APPROVAL', MARKET_GROWTH: 'ACTIVE', CONSENT_DEFAULTS: 'ACTIVE' }, flagDefined: true }).items.find((i) => i.id === 'configVersions')!.status).toBe('AWAITING_CHECKER');
    expect(readiness({ ...base, steps: {} as never }).items.filter((i) => i.status === 'TODO').length).toBeGreaterThanOrEqual(7);
  });
  it('a counsel-approved text id closes the consent text item; a held licence closes the licence item', () => {
    const r = readiness({ ...base, steps: { ...steps, consent: { ...steps.consent, textVersionIds: { analytics: 'v1', marketing: 'v1' } }, regulation: { ...regulation, marketingLicenceHeld: true } } as never });
    expect(r.items.find((i) => i.id === 'consentTexts')!.status).toBe('DONE'); expect(r.items.find((i) => i.id === 'marketingLicence')!.status).toBe('DONE');
  });
});

describe('data cells', () => {
  it('the embedded fallback equals platform/data-cells.json when the file is reachable, and an unknown cell is not in the list', () => {
    const f = resolve(__dirname, '../../../../../../platform/data-cells.json');
    if (existsSync(f)) expect(Object.keys(JSON.parse(readFileSync(f, 'utf8')).cells).sort()).toEqual([...EMBEDDED_DATA_CELLS].sort());
    const d = loadDataCells({ DATA_CELLS_FILE: '/nonexistent' } as never); expect(d.cells).toContain('frankfurt'); expect(d.cells).not.toContain('mars'); expect(d.bindings.EG).toBe('frankfurt');
  });
});
