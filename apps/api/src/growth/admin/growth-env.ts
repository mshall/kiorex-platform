/** Environment facts the admin API needs, read at call time so tests can change them. */
export const siteEnvironment = (): 'production' | 'staging' | 'development' => {
  const v = (process.env.SITE_ENVIRONMENT ?? '').trim(); // same rule as public-site/site.config.ts: only an explicit value counts
  return v === 'production' || v === 'staging' ? v : 'development';
};
export const isProductionSite = (): boolean => siteEnvironment() === 'production';
/** A stable label for this process in the propagation monitor: `<role>@<host>:<pid>`. */
export const INSTANCE_ID = process.env.GROWTH_INSTANCE_ID ?? `${process.env.SITE_ROLE ?? 'api'}@${process.env.HOSTNAME ?? 'local'}:${process.pid}`;
