import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import * as ts from 'typescript';
import { CODE_PROFILES, marketFacts, marketProfile, marketTimezone, marketQuietHours, setMarketProfileSnapshot } from './market-core-public';
import { normalizeMarketProfile } from './market-profile';

/**
 * GRW-GC-4b: no market-specific literal is hard-coded in the growth, public-site, widget, engagement, market and assistant code. Markets are configuration
 * (MARKET_PROFILE) with a code fallback; nothing may branch on `market == 'EG'`. The scan parses every source file with the TypeScript compiler, so comments
 * and identifiers never count and a string literal can not hide in a template or a multi-line expression.
 */
const SRC = resolve(__dirname, '..');
const ROOTS = ['growth', 'public-site', 'widget', 'engagement', 'market', join('ai-gateway', 'assistant')];
/** The only places a market code or zone may be written: the PROPOSED_DEFAULT payloads and the registry fallback (spec files are excluded by name). */
const ALLOW = new Set([join('growth', 'config', 'growth-defaults.ts'), join('market', 'market-registry.ts')].map((p) => p.split(sep).join('/')));
/** The Egyptian-colloquial Arabic REGISTER of the WhatsApp assistant is called `eg` (Dialect = 'eg' | 'msa' | 'en'): a language register, not a market, and it is stored in conversations, so it is not renamed. Only these files and only that value. */
const DIALECT_FILES = new Set(['ai-gateway/assistant/assistant.types.ts', 'ai-gateway/assistant/assistant.lexicon.ts', 'ai-gateway/assistant/assistant-record.cli.ts']);
const FORBIDDEN_CODE = /^(EG|SA|AE)$/i;
const FORBIDDEN_ZONE = /^(Africa\/Cairo|Asia\/Riyadh|Asia\/Dubai)$/;

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(p) ? [p] : []; });

export function findLiterals(text: string, name = 'x.ts'): { text: string; line: number }[] {
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const hits: { text: string; line: number }[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && (FORBIDDEN_CODE.test(n.text) || FORBIDDEN_ZONE.test(n.text))) hits.push({ text: n.text, line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1 });
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

describe('no market literals (GC-4b)', () => {
  it('the scanner finds a code or a zone in any string form and ignores comments, identifiers and other locales', () => {
    expect(findLiterals(`const a = 'EG'; const b = "sa"; const c = \`AE\`; const d = 'Africa/Cairo'; if (m === 'eg') {}`).map((h) => h.text)).toEqual(['EG', 'sa', 'AE', 'Africa/Cairo', 'eg']);
    expect(findLiterals(`// 'EG'\n/* "SA" */ const EG = 1; const l = 'ar-EG'; const s = 'EGP'; const t = \`\${x}EG\`;`)).toEqual([]);
  });

  it('no source file under the scanned folders contains one outside the allow-list', () => {
    const bad: string[] = [];
    for (const r of ROOTS) for (const f of walk(join(SRC, r))) {
      const rel = relative(SRC, f).split(sep).join('/');
      if (ALLOW.has(rel)) continue;
      for (const h of findLiterals(readFileSync(f, 'utf8'), f)) if (!(DIALECT_FILES.has(rel) && h.text === 'eg')) bad.push(`${rel}:${h.line} ${JSON.stringify(h.text)}`);
    }
    expect(bad).toEqual([]);
  });

  it('the dialect exception covers only the value eg in three files that exist', () => {
    for (const f of DIALECT_FILES) { expect(statSync(join(SRC, f)).isFile()).toBe(true); expect(findLiterals(readFileSync(join(SRC, f), 'utf8')).every((h) => h.text === 'eg')).toBe(true); }
  });
  it('the allow-list is only the two documented files and both exist', () => {
    expect([...ALLOW].sort()).toEqual(['growth/config/growth-defaults.ts', 'market/market-registry.ts']);
    for (const f of ALLOW) expect(statSync(join(SRC, f)).isFile()).toBe(true);
  });
});

describe('registry resolution (config first, code fallback second)', () => {
  afterEach(() => setMarketProfileSnapshot([]));
  const zy = () => normalizeMarketProfile({ cc: 'ZY', name: { ar: 'زد واي', en: 'Zeta Yankee' }, currency: 'JOD', minorUnits: 3, phoneCode: '+962', timezone: 'Asia/Amman', locales: ['ar', 'en'], defaultLocale: 'ar', canonicalSegment: 'zy', quietHours: { start: '22:00', end: '08:00' }, workingWeek: [0, 1, 2, 3, 4], regulation: { marketingLicenceRequired: true, marketingLicenceHeld: false, consentRegimeId: 'X', minimumAge: 18, healthAdvertisingRestricted: true, reviewMarkupAllowed: false, dataExportRuleId: 'X' } });

  it('the code fallback answers for EG, SA and AE exactly as before', () => {
    expect(marketFacts('EG')).toEqual({ currency: 'EGP', phoneCode: '+20', name: { ar: 'مصر', en: 'Egypt' } });
    expect(marketFacts('sa').currency).toBe('SAR'); expect(marketFacts('AE').phoneCode).toBe('+971');
    expect([marketTimezone('EG'), marketTimezone('SA'), marketTimezone('AE')]).toEqual(['Africa/Cairo', 'Asia/Riyadh', 'Asia/Dubai']);
    expect(Object.keys(CODE_PROFILES).sort()).toEqual(['AE', 'EG', 'SA']);
  });
  it('an unknown market has no facts and the UTC zone (never a guessed country)', () => {
    expect(marketProfile('ZY')).toBeUndefined(); expect(marketFacts('ZY')).toEqual({ currency: '', phoneCode: '', name: { ar: 'ZY', en: 'ZY' } }); expect(marketTimezone('ZY')).toBe('UTC');
  });
  it('a configured market resolves everywhere the registry is read, and configuration wins over the fallback', () => {
    setMarketProfileSnapshot([zy(), { ...CODE_PROFILES.SA!, currency: 'XSR' }]);
    expect(marketFacts('ZY')).toEqual({ currency: 'JOD', phoneCode: '+962', name: { ar: 'زد واي', en: 'Zeta Yankee' } });
    expect(marketTimezone('ZY')).toBe('Asia/Amman'); expect(marketQuietHours('ZY')).toEqual({ start: '22:00', end: '08:00', timezone: 'Asia/Amman' });
    expect(marketFacts('SA').currency).toBe('XSR'); expect(marketFacts('EG').currency).toBe('EGP');
  });
});
