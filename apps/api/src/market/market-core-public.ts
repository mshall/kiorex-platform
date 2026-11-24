/** Leaf façade of the market registry: the registry itself is pure; the only service here (the config-backed snapshot loader) depends on the shared Prisma kernel alone, so any module may import this file without an import cycle. */
export { MarketProfileService } from './market-profile.service';
export { DEFAULT_MARKET, UNKNOWN_MARKET_ZONE, CODE_PROFILES, MARKET_FACTS, marketFacts, marketProfile, marketTimezone, marketQuietHours, marketCurrency, marketMinorUnits, setMarketProfileSnapshot, marketProfileSnapshot, knownProfileCodes, type MarketFacts } from './market-registry';
export { validateMarketProfile, normalizeMarketProfile, isValidTimezone, formatMoneyMinor, LOCALES, type MarketProfile, type MarketRegulation, type MarketLocale } from './market-profile';
