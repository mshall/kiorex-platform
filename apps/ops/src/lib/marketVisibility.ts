// Single rule for every country/market selector (founder decision, 23 Nov 2026): Egypt is the only launch market,
// so a selector is shown only when MORE THAN ONE market is live (effective market.<cc>.live). With one market the
// value is fixed (EG: phone +20, EGP, Arabic default). The API stays multi-market; only the UI choice is hidden.
export interface MarketLiveRow { code: string; live: boolean }
export const FALLBACK_MARKET = "EG";
export const liveMarkets = (markets: readonly MarketLiveRow[] | undefined | null): MarketLiveRow[] => (markets ?? []).filter((m) => m.live);
export const shouldShowMarketSelector = (markets: readonly MarketLiveRow[] | undefined | null): boolean => liveMarkets(markets).length > 1;
/** The market to use when the selector is hidden: the only live market, else Egypt. */
export const fixedMarket = (markets: readonly MarketLiveRow[] | undefined | null): string => liveMarkets(markets)[0]?.code.toUpperCase() ?? FALLBACK_MARKET;
