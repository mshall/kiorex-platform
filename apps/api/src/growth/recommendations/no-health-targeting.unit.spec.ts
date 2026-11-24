import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * ARCH 14 / ADR-007 for GRW-P3-E: the automation and recommendation code never imports a patient, booking, catalogue, records, referral or provider module, never builds an audience, never calls
 * an ad platform, and never logs a token. The rules read aggregates; the journey runner reaches people only through the P2-E lifecycle module. (The automation hooks read ONE person's
 * non-clinical lifecycle row for a condition, and the trigger scan reads ids and times of events; neither imports a clinical module.)
 */
const GROWTH = resolve(__dirname, '..');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('.fixtures.ts') ? [p] : []; });
const SCOPE = [...walk(join(GROWTH, 'automation')), ...walk(join(GROWTH, 'recommendations'))];
const imports = (s: string) => [...s.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
const code = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('no health targeting in automation and recommendations (GRW-P3-E)', () => {
  it('scans a non-trivial set of files', () => { expect(SCOPE.length).toBeGreaterThan(20); });
  it('imports no patient, booking, catalogue, records, referral, waitlist, telemedicine, home care, lab or pharmacy module', () => {
    const bad: string[] = [];
    for (const f of SCOPE) for (const i of imports(code(f))) if (/(^|\/)(patient|booking|catalog|records|referral|waitlist|trust|telemedicine|homecare|lab|pharmacy|channels|integrations)(\/|-public|$)/.test(i)) bad.push(`${f.replace(GROWTH, '')} -> ${i}`);
    expect(bad).toEqual([]);
  });
  it('recommendations import no lifecycle, engagement or messaging module at all (they cannot send)', () => {
    const bad: string[] = [];
    for (const f of walk(join(GROWTH, 'recommendations'))) for (const i of imports(code(f))) if (/(lifecycle|engagement|messaging|channels)/.test(i)) bad.push(`${f.replace(GROWTH, '')} -> ${i}`);
    expect(bad).toEqual([]);
  });
  it('contains no audience, lookalike, custom-match or retargeting construct and no ad-platform host', () => {
    const bad: string[] = [];
    for (const f of SCOPE.filter((x) => !/(assert-aggregate-only|health-terms)\.ts$/.test(x))) { const s = code(f); if (/lookalike|custommatch|custom_match|retarget|audience\s*[:=(]|googleads|graph\.facebook|business-api\.tiktok/i.test(s)) bad.push(f.replace(GROWTH, '')); }
    expect(bad).toEqual([]);
  });
  it('never references a specialty, diagnosis, doctor or provider identifier outside the guard lists, and never logs a token or header', () => {
    const bad: string[] = [];
    for (const f of SCOPE.filter((x) => !/(assert-aggregate-only|health-terms|recommendation-inputs\.service)\.ts$/.test(x))) {
      const s = code(f).replace(/\bu\.sub\b/g, 'u.actor');
      if (/specialt(y|ies)(?!\s*\))|diagnos|providerId|doctorId|patientId|console\.(log|info|warn|error)/.test(s)) bad.push(`${f.replace(GROWTH, '')} health`);
      for (const m of s.matchAll(/(?:log|this\.log)\.(?:log|warn|error|debug)\(([^)]*)\)/g)) if (/header|token|secret|authorization|apiKey/i.test(m[1]!)) bad.push(`${f.replace(GROWTH, '')} log`);
    }
    expect(bad).toEqual([]);
  });
  it('the closed vocabulary has no send, spend, activate, target or audience action', () => {
    const t = readFileSync(join(GROWTH, 'recommendations', 'recommendation.types.ts'), 'utf8');
    const kinds = /RECOMMENDATION_KINDS = \[([^\]]+)\]/.exec(t)![1]!;
    expect(kinds).not.toMatch(/SEND|SPEND|ACTIVATE|TARGET|AUDIENCE|BID|BUDGET_SET|MESSAGE/);
  });
  it('the only writes the recommendation service makes to other tables are a DRAFT campaign and a DRAFT config version', () => {
    const s = code(join(GROWTH, 'recommendations', 'recommendation.service.ts'));
    expect(s).toContain('this.campaigns.create('); expect(s).toContain('this.config.createDraft(');
    expect(s).not.toMatch(/campaigns\.(transition|activate|approve|requestApproval)|config\.(approve|submit|activate)|engagement|notify\(|\.growthSpendEntry\.(create|update)|\.growthCampaign\.(update|create)/);
  });
});
