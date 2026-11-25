import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const GROWTH = join(__dirname, '..');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(p) ? [p] : []; });
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * QUARANTINE_TOUCH coverage: every module that COUNTS or GROUPS touches for a report must leave out a quarantined touch. A module that only reads touches to DECIDE (attribution decision, evidence, claim,
 * product decision) must not: a decision is append-only and the fraud action never changes it. A new reader fails this test until it is classified.
 */
const DECISION_TIME_READERS: Record<string, string> = {
  'attribution/attribution.service.ts': 'decision engine: touches decide; a quarantine never changes a written or future decision',
  'evidence/evidence.service.ts': 'evidence viewer shows the touches of a decision as they were',
  'referral/referral-claim.service.ts': 'claim resolution reads the visitor touch that carried the code',
  'products/product-decision.service.ts': 'product decision evidence (same engine as the clinic decision)',
  'experiments/experiment-rollup.service.ts': 'joins a visitor key to a subject for conversion only; reads no touch kind or count',
};

describe('QUARANTINE_TOUCH coverage', () => {
  const readers = walk(GROWTH).map((f) => ({ rel: relative(GROWTH, f), text: code(readFileSync(f, 'utf8')) })).filter((f) => /growthTouchpoint\.(findMany|groupBy|count|aggregate)|"GrowthTouchpoint"/.test(f.text) && !f.rel.startsWith('fraud/'));
  it('finds the report modules', () => { expect(readers.length).toBeGreaterThanOrEqual(6); });
  it('every touch reader is either a classified decision-time reader or excludes quarantined touches', () => {
    for (const r of readers) {
      const ok = r.rel in DECISION_TIME_READERS || /quarantin|touch_quarantine/i.test(r.text);
      expect({ file: r.rel, ok }).toEqual({ file: r.rel, ok: true });
    }
  });
  it('the decision-time list does not hide a report: none of them groups or counts touches for display', () => {
    for (const r of readers.filter((x) => x.rel in DECISION_TIME_READERS)) expect({ file: r.rel, groups: /growthTouchpoint\.(groupBy|count|aggregate)/.test(r.text) }).toEqual({ file: r.rel, groups: false });
  });
});
