import type { CheckContext, CheckResult, PageContent } from '../page-model';

const BAD = /undefined|null|\[object|{{|}}|\{[a-z]+\}/i;

/** Title and description: length, no leaked placeholders, unique inside the locale. Duplicates are warnings (homonym providers get a suffix from the renderer); the rest too. */
export function titleMeta(p: PageContent, c: CheckContext): CheckResult[] {
  const issues: string[] = [];
  const { title, description } = c.cfg;
  if (p.title.length < title.min || p.title.length > title.max) issues.push(`title ${p.title.length} characters (${title.min} to ${title.max})`);
  if (p.description.length < description.min || p.description.length > description.max) issues.push(`description ${p.description.length} characters (${description.min} to ${description.max})`);
  if (BAD.test(p.title) || BAD.test(p.description)) issues.push('placeholder leaked into title or description');
  if ((c.titleOwners.get(p.title)?.length ?? 0) > 1) issues.push('duplicate title');
  if (p.description && (c.descriptionOwners.get(p.description)?.length ?? 0) > 1) issues.push('duplicate description');
  return issues.length ? [{ id: 'title-meta', ok: false, severity: 'warn', detail: issues.join('; ') }] : [{ id: 'title-meta', ok: true, severity: 'warn' }];
}
