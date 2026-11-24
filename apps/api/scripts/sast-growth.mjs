// GRW-GC-4 static SAST grep for the growth family (new folders of Phases 2 to 4 and the three React apps' growth folders). Fails CI on the sinks that turn data into code or markup:
// dangerouslySetInnerHTML, innerHTML / outerHTML / insertAdjacentHTML / document.write, eval / new Function, string-built raw SQL ($queryRawUnsafe / $executeRawUnsafe), child_process, and
// a request-controlled redirect. A line may opt out with a trailing `// sast-ok: <reason>` (the reason is the review record). Run: `node scripts/sast-growth.mjs [--json]`.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = resolve(HERE, '..');
const APPS = resolve(API, '..');
export const ROOTS = [
  join(API, 'src/growth'), join(API, 'src/ai-gateway/assistant'), join(API, 'src/channels'), join(API, 'src/widget'), join(API, 'src/public-site'),
  join(APPS, 'ops/src/pages/growth'), join(APPS, 'ops/src/components/growth'), join(APPS, 'web/src/lib'), join(APPS, 'web/src/pages'), join(APPS, 'widget/src'),
];
export const SINKS = [
  { id: 'react-html', re: /dangerouslySetInnerHTML/ },
  { id: 'dom-html', re: /\.(innerHTML|outerHTML)\s*[+]?=|insertAdjacentHTML\s*\(|document\.write(ln)?\s*\(/ },
  { id: 'eval', re: /(?<![.\w$])eval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]/ },
  { id: 'raw-sql', re: /\$(queryRawUnsafe|executeRawUnsafe)\s*\(/ },
  { id: 'process-exec', re: /child_process|\b(execSync|spawnSync|execFileSync)\s*\(/ },
  { id: 'open-redirect', re: /res\.redirect\s*\(\s*(req\.|query\.|body\.)/ },
];
const walk = (d) => (existsSync(d) ? readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? (f === 'node_modules' || f === 'dist' ? [] : walk(p)) : [p]; }) : []);
const isSource = (f) => /\.(ts|tsx|js|mjs)$/.test(f) && !/\.(spec|test|unit\.spec|int\.spec|node\.test)\.(ts|tsx|js|mjs)$/.test(f) && !/(^|\/)(test|__tests__|fixtures)\//.test(f);

export function scan(roots = ROOTS) {
  const hits = [];
  for (const root of roots) for (const f of walk(root).filter(isSource)) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/\/\/\s*sast-ok:/.test(line) || /^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const s of SINKS) if (s.re.test(line)) hits.push({ file: relative(APPS, f), line: i + 1, sink: s.id, text: line.trim().slice(0, 160) });
    });
  }
  return hits;
}
export function scanText(text) { return text.split('\n').flatMap((line, i) => (/\/\/\s*sast-ok:/.test(line) ? [] : SINKS.filter((s) => s.re.test(line)).map((s) => ({ line: i + 1, sink: s.id })))); }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hits = scan();
  if (process.argv.includes('--json')) console.log(JSON.stringify(hits));
  else for (const h of hits) console.error(`sast: ${h.sink} ${h.file}:${h.line}  ${h.text}`);
  process.exit(hits.length ? 1 : 0);
}
