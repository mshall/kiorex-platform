import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBreakdown, type Filters, type FilterKey, type Masked } from "@/api/growthAnalytics";
import { formatMinor } from "@/lib/format";
import { shouldShowMarketSelector, type MarketLiveRow } from "@/lib/marketVisibility";

export const MASK = "<10";
const day = (d: Date) => d.toISOString().slice(0, 10);
export const defaultFilters = (): Filters => ({ from: day(new Date(Date.now() - 29 * 86_400_000)), to: day(new Date()) });

/** A masked cell is announced as such; a number is formatted. Nothing derived from fewer than 10 people is ever shown. */
export function Cell({ v, lang, money, pct, ratio }: { v: Masked | null | undefined; lang: string; money?: boolean; pct?: boolean; ratio?: boolean }): ReactNode {
  const { t } = useTranslation();
  if (v === null || v === undefined) return <span className="text-muted-foreground" aria-label={t("ga.na")}>—</span>;
  if (v === MASK) return <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground" title={t("ga.maskedHint")} aria-label={t("ga.maskedAria")} data-testid="masked">{MASK}</span>;
  if (money) return <>{formatMinor(v, lang)}</>;
  if (pct) return <>{new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-US", { maximumFractionDigits: 2 }).format(v)}%</>;
  if (ratio) return <>{new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-US", { maximumFractionDigits: 2 }).format(v)}x</>;
  return <>{new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-US").format(v)}</>;
}

const SELECTORS: FilterKey[] = ["city", "district", "specialty", "provider", "doctor", "branch", "campaign", "channel"];
const LISTED: Partial<Record<FilterKey, string>> = { city: "city", specialty: "specialty", provider: "provider", campaign: "campaign", channel: "channel" };

function Suggest({ k, filters }: { k: FilterKey; filters: Filters }) {
  const dim = LISTED[k]!; const q = useBreakdown(dim, { from: filters.from, to: filters.to }, true);
  const opts = (q.data?.rows ?? []).map((r) => String(r[dim] ?? "")).filter(Boolean).slice(0, 50);
  return <datalist id={`ga-list-${k}`}>{opts.map((o) => <option key={o} value={o} />)}</datalist>;
}

/** Filters: period, country (hidden while one market is live), city, district, specialty, provider, doctor, branch, campaign, channel. Every control has a visible label. */
export function FilterBar({ value, onChange, markets, only }: { value: Filters; onChange: (f: Filters) => void; markets?: MarketLiveRow[]; only?: FilterKey[] }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Filters>(value);
  const set = (k: keyof Filters, v: string) => { const n = { ...draft, [k]: v || undefined } as Filters; setDraft(n); onChange(n); };
  const show = useMemo(() => SELECTORS.filter((k) => !only || only.includes(k)), [only]);
  return (
    <form className="mb-4 flex flex-wrap items-end gap-3" aria-label={t("ga.filters")} onSubmit={(e) => e.preventDefault()} data-testid="ga-filters">
      <div className="space-y-1"><Label htmlFor="ga-from">{t("ga.from")}</Label><Input id="ga-from" type="date" value={draft.from} max={draft.to} onChange={(e) => set("from", e.target.value)} className="w-40" /></div>
      <div className="space-y-1"><Label htmlFor="ga-to">{t("ga.to")}</Label><Input id="ga-to" type="date" value={draft.to} min={draft.from} onChange={(e) => set("to", e.target.value)} className="w-40" /></div>
      {shouldShowMarketSelector(markets) && (
        <div className="space-y-1"><Label htmlFor="ga-country">{t("ga.country")}</Label>
          <select id="ga-country" className="h-11 rounded-lg border bg-card px-3 text-sm" value={draft.country ?? ""} onChange={(e) => set("country", e.target.value)}>
            <option value="">{t("ga.all")}</option>{(markets ?? []).filter((m) => m.live).map((m) => <option key={m.code} value={m.code}>{m.code}</option>)}
          </select></div>
      )}
      {show.map((k) => (
        <div key={k} className="space-y-1"><Label htmlFor={`ga-${k}`}>{t(`ga.filter.${k}`)}</Label>
          <Input id={`ga-${k}`} value={draft[k] ?? ""} list={LISTED[k] ? `ga-list-${k}` : undefined} maxLength={64} onChange={(e) => set(k, e.target.value.trim())} className="w-40" autoComplete="off" />
          {LISTED[k] ? <Suggest k={k} filters={draft} /> : null}
        </div>
      ))}
    </form>
  );
}
