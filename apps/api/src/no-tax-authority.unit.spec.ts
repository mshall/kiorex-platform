import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * ⛔ NO TAX-AUTHORITY REPORTING (founder decision, ADR-011, KX-01, FD-02; CLAUDE.md). No product in this ecosystem integrates
 * with, submits to or reports to any tax authority (no ETA e-invoicing / e-receipt, no ZATCA, no FTA, no fiscal devices, no
 * signing certificates / e-seals). Products MAY show a configurable VAT line on Kiorex's OWN fee statements and export data
 * for an accountant. This test fails the build if source, schema or migrations mention such an integration.
 * (Spec files are excluded so this file can name the patterns.)
 */
const ROOT = resolve(__dirname, '..');
const FORBIDDEN: [string, RegExp][] = [
  ['ETA (Egyptian Tax Authority)', /\bETA\b/],
  ['e-invoice', /\be[-_]?invoic/i],
  ['e-receipt', /\be[-_]?receipt/i],
  ['ZATCA', /zatca/i],
  ['FTA', /\bFTA\b/],
  ['e-seal / signing certificate', /\be[-_]?seal\b|signing[-_ ]certificate/i],
  ['fiscal device', /fiscal[-_ ]?(device|printer|memory)/i],
  ['tax-authority submission', /tax[-_ ]?authority[-_ ]?(submi|report|api|client)|submit[a-z]*[-_ ]to[-_ ]the[-_ ]tax/i],
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    if (['node_modules', 'dist', '.data', 'openapi'].includes(f)) return [];
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('no tax-authority reporting anywhere (KX-01 ADR-011)', () => {
  const files = ['src', 'prisma', 'scripts'].flatMap((d) => walk(join(ROOT, d))).filter((f) => /\.(ts|mjs|js|json|prisma|sql|md)$/.test(f) && !/\.spec\.ts$/.test(f));
  it('scans a meaningful number of files', () => { expect(files.length).toBeGreaterThan(50); });
  it('no source, schema or migration references tax-authority submission', () => {
    const hits: string[] = [];
    for (const f of files) {
      const s = readFileSync(f, 'utf8');
      for (const [name, re] of FORBIDDEN) if (re.test(s)) hits.push(`${relative(ROOT, f)}: ${name}`);
    }
    expect(hits).toEqual([]);
  });
  it('the guard itself works (sanity)', () => {
    expect(FORBIDDEN.some(([, re]) => re.test('POST /eta/einvoice/submit'))).toBe(true);
    expect(FORBIDDEN.some(([, re]) => re.test('estimatedMinutes for delivery'))).toBe(false);
    expect(FORBIDDEN.some(([, re]) => re.test('drop the receipt so the next attempt'))).toBe(false);
    expect(FORBIDDEN.some(([, re]) => re.test('submitEReceipt(); e-invoice'))).toBe(true);
  });
});
