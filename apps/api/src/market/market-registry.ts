import { normalizeMarketProfile, type MarketProfile } from './market-profile';

/**
 * Code fallback of the market registry (GRW-P3-G). This file is the ONE place where market codes, currencies and time zones are written as literals (allow-listed in
 * `no-market-literals.unit.spec.ts`): the behaviour for EG, SA and AE is unchanged, and any market added through the `MARKET_PROFILE` configuration (the market wizard)
 * resolves from the configuration snapshot first. Whether a market is LIVE comes only from the `market.<cc>.live` flag (ADR-024), never from this table.
 */
export interface MarketFacts { currency: string; phoneCode: string; name: { ar: string; en: string } }

const REG = { marketingLicenceRequired: true, marketingLicenceHeld: false, consentRegimeId: 'pending-counsel', minimumAge: 18, healthAdvertisingRestricted: true, reviewMarkupAllowed: true, dataExportRuleId: 'pending-counsel' } as const;
const code = (cc: string, ar: string, en: string, currency: string, phoneCode: string, timezone: string, workingWeek: number[]): MarketProfile => normalizeMarketProfile({
  cc, name: { ar, en }, currency, minorUnits: 2, phoneCode, phoneRegion: cc, timezone, locales: ['ar', 'en'], defaultLocale: 'ar', canonicalSegment: cc.toLowerCase(), quietHours: { start: '21:00', end: '09:00' }, workingWeek,
  geographyRef: null, specialtiesRef: null, dataCellId: null, consentDefaultsRef: null, providerImportBatchId: null, regulation: { ...REG },
});
export const CODE_PROFILES: Readonly<Record<string, MarketProfile>> = {
  EG: code('EG', 'مصر', 'Egypt', 'EGP', '+20', 'Africa/Cairo', [0, 1, 2, 3, 4, 6]),
  SA: code('SA', 'السعودية', 'Saudi Arabia', 'SAR', '+966', 'Asia/Riyadh', [0, 1, 2, 3, 4]),
  AE: code('AE', 'الإمارات', 'United Arab Emirates', 'AED', '+971', 'Asia/Dubai', [1, 2, 3, 4, 5]),
};
export const MARKET_FACTS: Readonly<Record<string, MarketFacts>> = Object.fromEntries(Object.values(CODE_PROFILES).map((p) => [p.cc, { currency: p.currency, phoneCode: p.phoneCode, name: p.name }]));

/** The market a request or job without a market context belongs to (single-market launch default). `DEFAULT_MARKET` env wins when it is a clean code. */
const envDefault = (process.env.DEFAULT_MARKET ?? '').trim().toUpperCase();
export const DEFAULT_MARKET: string = /^[A-Z]{2}$/.test(envDefault) ? envDefault : CODE_PROFILES.EG!.cc;
/** Time zone for a market nobody knows (never guesses a country). */
export const UNKNOWN_MARKET_ZONE = 'UTC';

let snapshot: ReadonlyMap<string, MarketProfile> = new Map();
/** Replaces the configuration snapshot (called by MarketProfileService after every refresh; tests call it directly). */
export function setMarketProfileSnapshot(list: readonly MarketProfile[]): void { snapshot = new Map(list.map((p) => [p.cc, p])); }
export const marketProfileSnapshot = (): readonly MarketProfile[] => [...snapshot.values()];

/** Configuration first (ACTIVE MARKET_PROFILE), then the code map. Undefined for a market nobody configured. */
export function marketProfile(cc: string): MarketProfile | undefined { const k = String(cc ?? '').toUpperCase(); return snapshot.get(k) ?? CODE_PROFILES[k]; }
export const marketFacts = (cc: string): MarketFacts => {
  const p = marketProfile(cc);
  return p ? { currency: p.currency, phoneCode: p.phoneCode, name: p.name } : { currency: '', phoneCode: '', name: { ar: String(cc).toUpperCase(), en: String(cc).toUpperCase() } };
};
export const marketTimezone = (cc: string): string => marketProfile(cc)?.timezone ?? UNKNOWN_MARKET_ZONE;
export const marketQuietHours = (cc: string): { start: string; end: string; timezone: string } => { const p = marketProfile(cc) ?? CODE_PROFILES[DEFAULT_MARKET] ?? CODE_PROFILES.EG!; return { ...p.quietHours, timezone: p.timezone }; };
export const marketCurrency = (cc: string): string => marketProfile(cc)?.currency ?? '';
export const marketMinorUnits = (cc: string): number => marketProfile(cc)?.minorUnits ?? 2;
export const knownProfileCodes = (): string[] => [...new Set([...snapshot.keys(), ...Object.keys(CODE_PROFILES)])].sort();
