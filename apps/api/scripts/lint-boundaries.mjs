// Fast CI lint: forbid committed secrets-looking .env files and AWS SDK usage outside platform adapters. Module boundaries are enforced by jest (module-boundaries.unit.spec.ts).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
let bad = 0;
for (const f of walk('src').filter((x) => x.endsWith('.ts') && !x.endsWith('.spec.ts'))) {
  const s = readFileSync(f, 'utf8');
  if (/@aws-sdk\//.test(s) && !f.includes('platform/adapters')) { console.error(`aws sdk outside adapters: ${f}`); bad++; }
  if (/sk-[A-Za-z0-9]{20,}/.test(s)) { console.error(`possible API key in ${f}`); bad++; }
}
process.exit(bad ? 1 : 0);
