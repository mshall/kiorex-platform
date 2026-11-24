import { PRIVATE_PATH_PREFIXES } from './url-policy';

/**
 * robots.txt generation (ARCH 4.1 rule 7). Per environment: production allows the public namespaces and references the sitemap index;
 * every other environment blocks everything. Robots is NOT a privacy control: private routes also send X-Robots-Tag noindex and need auth.
 */
export interface RobotsOpts { indexable: boolean; canonicalHost: string; locales: readonly string[] }

export function buildRobots(o: RobotsOpts): string {
  if (!o.indexable) return ['# Non-production environment: not for indexing.', 'User-agent: *', 'Disallow: /', ''].join('\n');
  const lines = ['User-agent: *'];
  for (const l of o.locales) lines.push(`Allow: /${l}/`);
  lines.push('Allow: /_p/', 'Allow: /.well-known/');
  for (const p of PRIVATE_PATH_PREFIXES) lines.push(`Disallow: ${p}`);
  lines.push('', `Sitemap: ${o.canonicalHost.replace(/\/+$/, '')}/sitemap.xml`, '');
  return lines.join('\n');
}
