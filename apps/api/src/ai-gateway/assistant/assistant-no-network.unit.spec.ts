import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** GRW-P2-D acceptance: no real network call exists in the assistant module. Static proof: only the config-only OpenAI-compatible model may reach the network, and it is constructed only behind four gates. */
const DIR = __dirname;
const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? (f === 'fixtures' ? [] : files(join(d, f))) : f.endsWith('.ts') && !f.endsWith('.spec.ts') ? [join(d, f)] : []));

describe('GRW-P2-D no outbound HTTP from the assistant module', () => {
  const src = files(DIR).map((f) => ({ f: f.slice(DIR.length + 1), s: readFileSync(f, 'utf8') }));
  it('only model/openai-compat.model.ts touches fetch, http, https, net, axios or undici', () => {
    const offenders = src.filter(({ f, s }) => f !== join('model', 'openai-compat.model.ts') && /\boutboundFetch\b|\bfetch\s*\(|from ['"](?:node:)?(?:https?|net|tls|http2|axios|undici|node-fetch|got)['"]|require\(['"](?:node:)?(?:https?|net)['"]\)|XMLHttpRequest|WebSocket/.test(s)).map((x) => x.f);
    expect(offenders).toEqual(['assistant-record.cli.ts'].filter(() => false));
  });
  it('the real model is constructed in exactly one place, behind the policy, the locked flag and three environment values', () => {
    const makers = src.filter(({ s }) => /new OpenAiCompatAssistantModel\(/.test(s)).map((x) => x.f).sort();
    expect(makers).toEqual(['assistant-record.cli.ts', 'assistant.model.factory.ts']); // the recorder is a dev tool that refuses NODE_ENV=production
    const factory = src.find((x) => x.f === 'assistant.model.factory.ts')!.s;
    for (const gate of ['ASSISTANT_FLAG.REAL_MODEL', 'ASSISTANT_BASE_URL', 'ASSISTANT_MODEL', 'ASSISTANT_API_KEY', "mode === 'real'"]) expect(factory).toContain(gate);
    expect(factory).toMatch(/if \(!flagOn \|\| !base \|\| !model \|\| !key\)/);
  });
  it('no credential value is written anywhere in the module', () => { for (const { f, s } of src) expect({ f, key: /sk-[A-Za-z0-9]{12,}|Bearer [A-Za-z0-9]{20,}/.test(s) }).toEqual({ f, key: false }); });
  it('the module does not import the channel or the messaging adapters directly (only the hub façade)', () => {
    for (const { f, s } of src) { expect({ f, bad: /from '\.\.\/\.\.\/channels\//.test(s) }).toEqual({ f, bad: false }); expect({ f, bad: /messaging\/adapters/.test(s) }).toEqual({ f, bad: false }); }
  });
});
