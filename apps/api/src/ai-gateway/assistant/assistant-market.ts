import { AsyncLocalStorage } from 'node:async_hooks';
import { DEFAULT_MARKET, marketTimezone } from '../../market/market-core-public';
import { marketZone } from '../../common/market-time';

/**
 * The market of the conversation being answered (ZY readiness gap closure). The renderer, the date helpers and the money formatter read it instead of the process default, so a reply in a
 * conversation of a second market prints that market's currency, minor units and time zone. A turn runs inside `inConversationMarket`; outside a turn (tests, jobs) the default market applies,
 * so behaviour for the default market is unchanged (its zone is still `MARKET_TIME_ZONE`).
 */
const store = new AsyncLocalStorage<string>();
export const inConversationMarket = <T>(market: string, fn: () => T): T => store.run(market, fn);
export const conversationMarket = (): string => store.getStore() ?? DEFAULT_MARKET;
/** IANA zone of the conversation market: the registry zone for another market, the configured process zone for the default one. */
export const conversationZone = (): string => { const m = conversationMarket(); return m === DEFAULT_MARKET ? marketZone() : marketTimezone(m); };
