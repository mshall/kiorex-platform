// Size budget (GRW-P1-G): the SDK must stay under 10 KB gzip (package target ~3 KB); the widget app JS+CSS has its own, looser, budget.
import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SDK_BUDGET = Number(process.env.WIDGET_SDK_BUDGET_GZIP ?? 10 * 1024);
const APP_BUDGET = Number(process.env.WIDGET_APP_BUDGET_GZIP ?? 40 * 1024);
const gz = (p) => gzipSync(readFileSync(p), { level: 9 }).length;
const fail = [];
const m = join(root, 'dist/sdk/manifest.json');
if (!existsSync(m)) { console.error('dist/sdk/manifest.json missing: run npm run build'); process.exit(1); }
const sdk = JSON.parse(readFileSync(m, 'utf8'));
const sdkGz = gz(join(root, 'dist/sdk', sdk.file));
console.log(`SDK ${sdkGz} B gzip (budget ${SDK_BUDGET})`);
if (sdkGz > SDK_BUDGET) fail.push(`SDK ${sdkGz} > ${SDK_BUDGET}`);
const app = join(root, 'dist/app');
const files = readdirSync(app).filter((f) => /\.(js|css)$/.test(f) && !f.startsWith('callback'));
const total = files.reduce((n, f) => n + gz(join(app, f)), 0);
console.log(`App ${total} B gzip over ${files.join(', ')} (budget ${APP_BUDGET})`);
if (total > APP_BUDGET) fail.push(`app ${total} > ${APP_BUDGET}`);
if (fail.length) { console.error(`BUDGET EXCEEDED: ${fail.join('; ')}`); process.exit(1); }
