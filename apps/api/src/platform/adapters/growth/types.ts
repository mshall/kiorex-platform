/**
 * GRW-P2-F adapter contract (platform layer). This folder is the only place a vendor HTTP client may live (ADR-028). It imports nothing from the growth module:
 * the growth module owns policy (modes, circuit breaker, PHI guard, persistence) and talks to adapters only through this port.
 */
export const GROWTH_INTEGRATION_KINDS = ['googleads', 'searchconsole', 'ga4', 'playconsole', 'appstoreconnect', 'metaads', 'tiktok', 'whatsappcloud', 'fcmapns', 'crux'] as const;
export type GrowthIntegrationKind = (typeof GROWTH_INTEGRATION_KINDS)[number];
export type AdapterMode = 'mock' | 'real';

/** Inclusive calendar days, `YYYY-MM-DD`. `dimensionKeys` are the campaign keys (utm_campaign) the caller wants rows for; a store or search adapter ignores them. */
export interface PullRange { from: string; to: string; dimensionKeys?: string[]; currency?: string }

/** One aggregate number. `dimensionKey` is a campaign key, a page template (`template:doctor`), a channel or a country; never a person, booking, provider or specialty. */
export interface MetricRow { day: string; dimensionKey: string; metric: string; value: number; currency?: string }

export interface AdapterHealth { ok: boolean; mode: AdapterMode; detail: string }

/** The only shape that may leave the platform towards an ad network (default off). `assertAdSafe` enforces it. */
export interface AnonymizedConversion { eventName: string; occurredAtHour: string; market: string; valueMinor?: number; currency?: string; campaignRef: string; clickId?: string }

export interface GrowthAdapter {
  readonly kind: GrowthIntegrationKind;
  readonly mode: AdapterMode;
  health(): Promise<AdapterHealth>;
  pullSpend?(range: PullRange): Promise<MetricRow[]>;
  pullPerformance?(range: PullRange): Promise<MetricRow[]>;
  pullCoreVitals?(range: PullRange): Promise<MetricRow[]>;
  pushConversion?(c: AnonymizedConversion): Promise<{ accepted: boolean }>;
}

/** Thrown by every real adapter that is not fully configured. 503 so a caller sees "not available", never a silent empty result. */
export class NeedsHumanError extends Error {
  readonly code = 'NEEDS_HUMAN';
  constructor(readonly kind: string, readonly reason: string) { super(`NEEDS_HUMAN: ${kind} ${reason}`); }
}

/** Failure classes the circuit breaker distinguishes; messages never carry a header, a token or a response body. */
export class UpstreamError extends Error {
  constructor(readonly errorCode: 'UPSTREAM_TIMEOUT' | 'UPSTREAM_STATUS' | 'UPSTREAM_PARSE' | 'RATE_LIMITED', readonly status?: number) { super(errorCode + (status ? `:${status}` : '')); }
}

export const SECRET_REF = /^[a-z0-9/_-]{1,120}$/;
