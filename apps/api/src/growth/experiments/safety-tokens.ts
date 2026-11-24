import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

let cached: string[] | undefined;
/** The forbiddenKeyTokens of the shared safety file (contracts `flags/safety-never-flags.json`, ADR-025), read once. A surface or flag name containing any of them is refused. Falls back to the empty list only if the vendored file is missing (the unit test asserts it is found). */
export function safetyTokens(): string[] {
  if (cached) return cached;
  try {
    const req = createRequire(__filename);
    const file = req.resolve('@kiorex/contracts/package.json').replace('package.json', 'flags/safety-never-flags.json');
    const j = JSON.parse(readFileSync(file, 'utf8')) as { items: { forbiddenKeyTokens: string[] }[] };
    cached = j.items.flatMap((i) => i.forbiddenKeyTokens);
  } catch { cached = []; }
  return cached;
}
