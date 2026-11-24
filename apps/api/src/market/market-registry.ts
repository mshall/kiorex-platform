/**
 * Reference facts about a market (ISO currency, phone code, display names). This is reference data, not a launch decision: whether a market is
 * LIVE comes only from the `market.<cc>.live` flag (ADR-024). A market that has a flag definition but no entry here is still listed (with empty
 * currency and phone code) so adding a market never needs a code change to stay reachable, only to show names.
 */
export interface MarketFacts { currency: string; phoneCode: string; name: { ar: string; en: string } }
export const MARKET_FACTS: Readonly<Record<string, MarketFacts>> = {
  EG: { currency: 'EGP', phoneCode: '+20', name: { ar: 'مصر', en: 'Egypt' } },
  SA: { currency: 'SAR', phoneCode: '+966', name: { ar: 'السعودية', en: 'Saudi Arabia' } },
  AE: { currency: 'AED', phoneCode: '+971', name: { ar: 'الإمارات', en: 'United Arab Emirates' } },
};
export const marketFacts = (cc: string): MarketFacts => MARKET_FACTS[cc.toUpperCase()] ?? { currency: '', phoneCode: '', name: { ar: cc.toUpperCase(), en: cc.toUpperCase() } };
