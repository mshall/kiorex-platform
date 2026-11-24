import type { AdapterHealth, AdapterMode, AnonymizedConversion, GrowthAdapter, GrowthIntegrationKind, MetricRow, PullRange } from '../../platform/platform-public';

export type { AdapterHealth, AdapterMode, AnonymizedConversion, GrowthAdapter, GrowthIntegrationKind, MetricRow, PullRange };
/** The growth-side name of the port (GRW-P2-F): `{ kind; mode; health(); pullSpend?; pullPerformance?; pushConversion?; pullCoreVitals? }`. */
export type GrowthIntegrationPort = GrowthAdapter;
export { GROWTH_INTEGRATION_KINDS } from '../../platform/platform-public';

/** Kinds whose spend feeds campaign spend lines (paid media). */
export const PAID_KINDS: readonly GrowthIntegrationKind[] = ['googleads', 'metaads', 'tiktok'];
/** What each kind pulls, so the scheduler never calls a method the adapter does not have. */
export const PULLS: Record<GrowthIntegrationKind, Array<'spend' | 'performance' | 'coreVitals'>> = {
  googleads: ['spend', 'performance'], searchconsole: ['performance'], ga4: ['performance'], playconsole: ['performance'], appstoreconnect: ['performance'],
  metaads: ['spend', 'performance'], tiktok: ['spend', 'performance'], whatsappcloud: ['performance'], fcmapns: ['performance'], crux: ['coreVitals'],
};
/** Documentation of where each integration processes and keeps data (also rendered on the ops page and in Docs/GROWTH_INTEGRATIONS.md). */
export const INTEGRATION_META: Record<GrowthIntegrationKind, { label: string; retentionMonths: number; location: string; rateBudgetPerMin: number; fallback: string; defaultOff: boolean }> = {
  googleads: { label: 'Google Ads', retentionMonths: 25, location: 'Kiorex cell (frankfurt), aggregates cross-border', rateBudgetPerMin: 60, fallback: 'manual spend entry', defaultOff: false },
  searchconsole: { label: 'Google Search Console', retentionMonths: 25, location: 'Kiorex cell (frankfurt)', rateBudgetPerMin: 30, fallback: 'manual CSV import', defaultOff: false },
  ga4: { label: 'GA4', retentionMonths: 25, location: 'Kiorex cell (frankfurt)', rateBudgetPerMin: 30, fallback: 'first-party analytics', defaultOff: true },
  playconsole: { label: 'Google Play Console', retentionMonths: 25, location: 'Kiorex cell (frankfurt)', rateBudgetPerMin: 20, fallback: 'manual CSV import', defaultOff: false },
  appstoreconnect: { label: 'App Store Connect', retentionMonths: 25, location: 'Kiorex cell (frankfurt)', rateBudgetPerMin: 20, fallback: 'manual CSV import', defaultOff: false },
  metaads: { label: 'Meta Ads', retentionMonths: 25, location: 'Kiorex cell (frankfurt)', rateBudgetPerMin: 60, fallback: 'manual spend entry', defaultOff: false },
  tiktok: { label: 'TikTok Ads', retentionMonths: 25, location: 'Kiorex cell (frankfurt)', rateBudgetPerMin: 30, fallback: 'manual spend entry', defaultOff: false },
  whatsappcloud: { label: 'Meta WhatsApp Cloud', retentionMonths: 25, location: 'Kiorex cell (frankfurt)', rateBudgetPerMin: 30, fallback: 'MessageLog counts', defaultOff: false },
  fcmapns: { label: 'FCM and APNs', retentionMonths: 13, location: 'Kiorex cell (frankfurt)', rateBudgetPerMin: 0, fallback: 'in-app channel', defaultOff: false },
  crux: { label: 'Chrome UX Report', retentionMonths: 13, location: 'Kiorex cell (frankfurt)', rateBudgetPerMin: 10, fallback: 'synthetic Lighthouse', defaultOff: false },
};
