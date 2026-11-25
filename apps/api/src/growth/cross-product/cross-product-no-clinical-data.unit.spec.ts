import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * GRW-P4-A rule 5 and the "no PHI in growth" rule, enforced as a guard: the schema of the two cross-product tables and the source of this folder never name clinical content,
 * and never reach the reward, referral or credit code (rule 4: a downstream order never creates a reward or counts as a referral qualification).
 */
const API = resolve(__dirname, '..', '..', '..');
const schema = readFileSync(join(API, 'prisma', 'schema.prisma'), 'utf8');
const model = (name: string) => schema.slice(schema.indexOf(`model ${name} {`), schema.indexOf('\n}\n', schema.indexOf(`model ${name} {`)));
const FORBIDDEN_COLUMN = /specialt|clinic[^a-z]|clinicId|doctor|provider|clinician|diagnos|symptom|item|test(?!ing)|drug|medic|prescri|lab(?:Id|Name)|note|name|phone|email|address|patient|booking(?:Id)?\b/i;

describe('cross-product tables hold no clinical data (schema guard)', () => {
  it('CrossProductContinuity has only product names, keyed hashes, decision ids, origins, lag and time', () => {
    const cols = [...model('CrossProductContinuity').matchAll(/^\s{2}(\w+)\s+/gm)].map((m) => m[1]).filter((c) => c !== 'model');
    expect(cols.sort()).toEqual(['createdAt', 'decisionId', 'entryPoint', 'fromFactRef', 'fromProduct', 'id', 'lagHours', 'market', 'parentDecisionId', 'parentOrigin', 'toFactRef', 'toOrigin', 'toProduct']);
    for (const c of cols) expect({ c, bad: FORBIDDEN_COLUMN.test(c) }).toEqual({ c, bad: false });
  });
  it('CrossProductEntryPoint holds a kind, a keyed hash, the own parent booking id and dates only', () => {
    const cols = [...model('CrossProductEntryPoint').matchAll(/^\s{2}(\w+)\s+/gm)].map((m) => m[1]).filter((c) => c !== 'model');
    expect(cols.sort()).toEqual(['consumedAt', 'createdAt', 'dismissedAt', 'expiresAt', 'factRef', 'id', 'kind', 'market', 'parentBookingId', 'parentHinted', 'sub']);
  });
});

describe('cross-product source never reads clinical fields or reaches money-reward code', () => {
  const src = readdirSync(__dirname).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts')).map((f) => ({ f, text: readFileSync(join(__dirname, f), 'utf8') }));
  const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('no read of items, soap, notes, tests, diagnosis, specialty or patient demographics from an event or a record payload', () => {
    for (const { f, text } of src) expect({ f, hit: /\b(?:d|data|env\.data|rec|record)\.(?:items|soap|notes|diagnos\w*|specialty\w*|patient|payloadEnc|summary)\b/.test(code(text)) }).toEqual({ f, hit: false });
  });
  it('no import of rewards, referral, credit, pay or campaign code', () => {
    for (const { f, text } of src) expect({ f, hit: /from\s+['"][^'"]*(?:rewards|referral|credit|\/pay\/|campaigns|lifecycle)[^'"]*['"]/.test(text) }).toEqual({ f, hit: false });
  });
  it('the only prisma tables written are the two cross-product tables', () => {
    for (const { f, text } of src) for (const m of code(text).matchAll(/prisma\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g)) expect({ f, t: m[1] }).toEqual({ f, t: expect.stringMatching(/^crossProduct(Continuity|EntryPoint)$/) });
  });
});
