import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Globe } from "lucide-react";
import { useMarkets } from "@/api/services";
import { getMarket, setMarket, subscribeMarket } from "@/lib/market";

export const regionName = (code: string, lang: string) => { try { return new Intl.DisplayNames([lang], { type: "region" }).of(code.toUpperCase()) ?? code; } catch { return code; } };

export const useMarket = () => useSyncExternalStore(subscribeMarket, getMarket, getMarket);

/** Country picker driven by GET /markets?all=true. A market is selectable only when market.<cc>.live is effective (launch-locked, ADR-024). */
export function MarketSelector() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const market = useMarket();
  const { data } = useMarkets();
  const markets = data?.length ? data : [{ code: "EG", live: true, flag: "market.eg.live", state: "LIVE" }];
  const options = markets.some((m) => m.code === market) ? markets : [...markets, { code: market, live: false, flag: `market.${market.toLowerCase()}.live`, state: "AWAITING_GATE" }];
  return (
    <label className="inline-flex min-h-11 items-center gap-1.5 text-sm">
      <Globe className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">{t("market.label")}</span>
      <select value={market} data-testid="market-select" onChange={(e) => { setMarket(e.target.value); void qc.invalidateQueries(); }} className="h-10 rounded-xl border border-input bg-card ps-3 pe-8 text-sm">
        {options.map((m) => <option key={m.code} value={m.code} disabled={!m.live && m.code !== market}>{regionName(m.code, i18n.language)}{m.live ? "" : ` — ${t("market.soon")}`}</option>)}
      </select>
    </label>
  );
}

/** Shown when the chosen market is not live (market.<cc>.live OFF or awaiting gate): browsing works, booking is paused. */
export function MarketNotLiveBanner() {
  const { t, i18n } = useTranslation();
  const market = useMarket();
  const { data } = useMarkets();
  const m = data?.find((x) => x.code === market);
  if (!data || (m && m.live)) return null;
  return <div role="status" className="border-b bg-warning-soft px-4 py-2 text-center text-sm text-warning" data-testid="market-not-live">{t("market.notLive", { country: regionName(market, i18n.language) })}</div>;
}
