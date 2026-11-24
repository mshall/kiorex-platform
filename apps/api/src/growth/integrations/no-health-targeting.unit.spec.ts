import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * ARCH 14 / ADR-007: the integration and analytics code never reaches patient, booking, segment or lifecycle modules, and never references a specialty type. It reads aggregates only.
 * Also asserts that no integration file logs a header or a token.
 */
const GROWTH = resolve(__dirname, '..');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? (f === 'fixtures' ? [] : walk(p)) : p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : []; });
const SCOPE = [...walk(join(GROWTH, 'integrations')), ...walk(resolve(GROWTH, '../platform/adapters/growth')), ...['external-metrics.service.ts', 'channel-performance.service.ts'].map((f) => join(GROWTH, 'analytics', f))];
const imports = (s: string) => [...s.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);

describe('no health targeting in integrations (GRW-P2-F)', () => {
  it('scans a non-trivial set of files', () => { expect(SCOPE.length).toBeGreaterThan(20); });
  it('imports no patient, booking, catalog, lifecycle, segment, referral or records module', () => {
    const bad: string[] = [];
    for (const f of SCOPE) for (const i of imports(readFileSync(f, 'utf8'))) if (/(^|\/)(patient|booking|catalog|records|lifecycle|engagement|segment|referral|waitlist|trust|telemedicine|homecare|lab|pharmacy)(\/|-public|$)/.test(i)) bad.push(`${f.replace(GROWTH, '')} -> ${i}`);
    expect(bad).toEqual([]);
  });
  it('references no specialty type, diagnosis or provider identifier outside the guard lists', () => {
    const bad: string[] = [];
    for (const f of SCOPE.filter((x) => !x.endsWith('assert-ad-safe.ts'))) { const s = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').replace(/\bu\.sub\b/g, 'u.actor'); if (/specialt(y|ies)(?!\s*\))|diagnos|providerId|bookingId|patientId|\bsub\b/i.test(s)) bad.push(f.replace(GROWTH, '')); }
    expect(bad).toEqual([]);
  });
  it('the real adapters never log, and nothing in scope logs a header or a token', () => {
    const bad: string[] = [];
    for (const f of SCOPE) { const s = readFileSync(f, 'utf8'); if (/console\.(log|info|warn|error)/.test(s)) bad.push(`${f} console`); for (const m of s.matchAll(/(?:log|this\.log)\.(?:log|warn|error|debug)\(([^)]*)\)/g)) if (/header|token|secret|authorization|bearer/i.test(m[1]!)) bad.push(`${f} ${m[1]}`); }
    expect(bad).toEqual([]);
  });
  it('the platform adapter folder is the only place with a vendor host', () => {
    const hosts = /googleads\.googleapis|graph\.facebook|business-api\.tiktok|analyticsdata\.googleapis|searchconsole\.googleapis|chromeuxreport|appstoreconnect\.apple|playdeveloperreporting/;
    const bad = walk(GROWTH).filter((f) => hosts.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});
