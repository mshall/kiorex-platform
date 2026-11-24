// Hashes dist/sdk-raw/sdk.js into dist/sdk/sdk.<hash>.js and writes dist/sdk/manifest.json with the SRI value (published by GET /v1/sdk.json and in Docs/WIDGET.md).
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'dist/sdk-raw/sdk.js'));
const hash = createHash('sha256').update(src).digest('hex').slice(0, 16);
const integrity = `sha384-${createHash('sha384').update(src).digest('base64')}`;
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
rmSync(join(root, 'dist/sdk'), { recursive: true, force: true });
mkdirSync(join(root, 'dist/sdk'), { recursive: true });
const file = `sdk.${hash}.js`;
writeFileSync(join(root, 'dist/sdk', file), src);
const manifest = { name: 'kiorex-widget.js', version, hash, file, path: `/v1/${hash}/sdk.js`, integrity, bytes: src.length, gzipBytes: gzipSync(src, { level: 9 }).length };
writeFileSync(join(root, 'dist/sdk/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`sdk ${version} ${hash}: ${manifest.bytes} B, ${manifest.gzipBytes} B gzip, ${integrity}`);
