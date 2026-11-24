import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSONLD_ALLOWED_TYPES, JSONLD_FORBIDDEN_KEYS } from './jsonld-rules';

const list = (src: string, name: string): string[] => [...(new RegExp(`${name}[^=]*=\\s*\\[([^\\]]*)\\]`).exec(src)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]!);

describe('JSON-LD rules stay identical to the public-site audit', () => {
  const audit = readFileSync(join(__dirname, '..', '..', 'public-site', 'seo-audit.ts'), 'utf8');
  it('allowed types and forbidden keys are the same lists', () => {
    expect(list(audit, 'JSONLD_ALLOWED_TYPES')).toEqual([...JSONLD_ALLOWED_TYPES]);
    expect(list(audit, 'JSONLD_FORBIDDEN_KEYS')).toEqual([...JSONLD_FORBIDDEN_KEYS]);
  });
});
