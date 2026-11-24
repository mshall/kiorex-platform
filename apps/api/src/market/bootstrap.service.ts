import { Injectable } from '@nestjs/common';
import { cfg } from '../common/config';
import { FlagsService } from '../control-plane/control-plane-public';
import { GROWTH_FLAG } from '../growth/growth-public';
import { chooseMarket, normalizeCc } from './deep-link-rules';
import { marketFacts } from './market-registry';
import { MarketService } from './market.service';

export interface BootstrapMarket { code: string; currency: string; phoneCode: string; name: { ar: string; en: string }; apiEndpoint: string }
export interface Bootstrap {
  defaultMarket: string;
  /** The market the client should use now: the link/hint market when LIVE, else the default. Never derived from IP or device location. */
  resolvedMarket: string;
  liveMarkets: string[];
  markets: BootstrapMarket[];
  locales: ('ar' | 'en')[];
  showMarketSelector: boolean;
  minAppVersion: string | null;
  /** Regional API base (with /api/v1) for the resolved market, from the market's binding. */
  apiEndpoint: string;
  /** Effective capability switches for the resolved market (flags), so a client hides what is off without a second call. */
  capabilities: Record<'deepLinks' | 'marketplace' | 'homeVisits', boolean>;
}

/** Parses REGIONAL_API_ENDPOINTS (`{"EG":"https://api.example.com/api/v1"}`); entries that are not clean http(s) origins+path are dropped. */
export function parseEndpointBindings(raw: string | undefined, isProd: boolean): Record<string, string> {
  if (!raw) return {};
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return {}; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const cc = k.toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc) || typeof v !== 'string') continue;
    try {
      const u = new URL(v);
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && !isProd)) continue;
      if (u.username || u.password || u.search || u.hash) continue;
      out[cc] = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
    } catch { /* drop */ }
  }
  return out;
}

/**
 * GET /api/v1/bootstrap (GRW-P1-H). The regional endpoint comes from the market's binding (env/tenant configuration), the market from the account
 * or link context (`?cc=`), never from the caller's physical location: no IP lookup, no geolocation header is read anywhere in this class.
 */
@Injectable()
export class BootstrapService {
  constructor(private readonly markets: MarketService, private readonly flags: FlagsService) {}

  async get(hintCc?: unknown): Promise<Bootstrap> {
    const [known, live] = await Promise.all([this.markets.known(), this.markets.liveMarkets()]);
    const c = cfg();
    const bindings = parseEndpointBindings(process.env.REGIONAL_API_ENDPOINTS, c.isProd);
    const fallback = `${c.publicBaseUrl.replace(/\/+$/, '')}/api/v1`;
    const endpointFor = (cc: string) => bindings[cc] ?? fallback;
    const configuredDefault = (process.env.DEFAULT_MARKET ?? '').toUpperCase();
    const defaultMarket = live.includes(configuredDefault) ? configuredDefault : (live[0] ?? (known.includes(configuredDefault) ? configuredDefault : (known[0] ?? configuredDefault)));
    const hint = normalizeCc(hintCc);
    const resolvedMarket = chooseMarket(hint, live, defaultMarket);
    const ctx = { market: resolvedMarket };
    const [deepLinks, marketplace, homeVisits] = await Promise.all([
      this.flags.isEnabled(GROWTH_FLAG.DEEP_LINKS, ctx), this.flags.isEnabled('kiorex.marketplace', ctx), this.flags.isEnabled('kiorex.home_visits', ctx),
    ]);
    return {
      defaultMarket,
      resolvedMarket,
      liveMarkets: live,
      markets: live.map((code) => ({ code, ...marketFacts(code), apiEndpoint: endpointFor(code) })),
      locales: ['ar', 'en'],
      showMarketSelector: live.length > 1,
      minAppVersion: (process.env.MIN_APP_VERSION ?? '').trim() || null,
      apiEndpoint: endpointFor(resolvedMarket),
      capabilities: { deepLinks, marketplace, homeVisits },
    };
  }
}
