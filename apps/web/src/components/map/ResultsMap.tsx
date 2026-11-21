import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, MapPin } from "lucide-react";
import type { DoctorSummary, SearchParams } from "@/api/types";
import { pointsFromDoctors } from "@/lib/map/points";
import { AREAS, areaLabel } from "@/lib/areas";
import { formatMoney, pick } from "@/lib/format";
import { LazyMap } from "./LazyMap";

/** KXMDS05: results as an interactive map. Markers = clinics of the providers on the current page; cluster at low zoom; "near me" re-sorts by distance. */
export function ResultsMap({ items, params, apply }: { items: DoctorSummary[]; params: SearchParams; apply: (p: SearchParams) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const points = useMemo(() => pointsFromDoctors(items, lang), [items, lang]);
  const [pickedId, setSelected] = useState<string | null>(null);
  const sel = items.find((d) => d.id === pickedId); // a selection that left the result list is dropped
  const selected = sel ? pickedId : null;
  const byArea = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of items) m.set(d.areaEn, (m.get(d.areaEn) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);
  const areaChips = (
    <div className="space-y-2 p-4">
      <h2 className="text-sm font-semibold">{t("results.byArea")}</h2>
      {byArea.length === 0 ? <p className="text-sm text-muted-foreground">{t("results.byAreaEmpty")}</p> : (
        <ul className="flex flex-wrap gap-2">
          {byArea.map(([a, n]) => (
            <li key={a}><button type="button" className="kx-chip min-h-10" aria-pressed={params.area === a} disabled={!AREAS.includes(a)} onClick={() => apply({ ...params, area: params.area === a ? undefined : a, page: 1 })}>{areaLabel(a, lang)}<span className="kx-label-num text-xs text-muted-foreground">{n}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
  const missing = items.length - points.length;
  return (
    <section aria-label={t("results.mapTitle")} className="space-y-3" data-testid="results-map">
      <div className="kx-card grid gap-0 overflow-hidden p-0 md:grid-cols-[1.6fr_1fr]">
        <LazyMap
          label={t("map.label")} className="min-h-[320px] rounded-none border-0 md:min-h-[420px]" points={points} selectedId={selected} onSelect={setSelected}
          onLocate={({ lat, lng }) => apply({ ...params, lat: Number(lat.toFixed(4)), lng: Number(lng.toFixed(4)), sort: "distance", page: 1 })}
          fallback={<div className="flex min-h-[320px] flex-col justify-center bg-accent"><p className="px-4 pt-4 text-sm text-muted-foreground" role="status">{t("map.unsupportedBrowser")}</p>{areaChips}</div>}
        />
        <div className="flex flex-col divide-y">
          <div className="space-y-2 p-4" data-testid="map-selection" aria-live="polite">
            {sel ? (
              <>
                <p className="text-xs font-semibold text-ocean">{t("map.selected")}</p>
                <p className="text-base font-semibold leading-snug">{pick(sel, "name", lang)}</p>
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><MapPin className="h-4 w-4" aria-hidden="true" />{pick(sel, "clinicName", lang)}{pick(sel, "area", lang) ? ` · ${pick(sel, "area", lang)}` : ""}</p>
                <p className="kx-label-num text-sm font-medium">{t("doctor.feeFrom", { fee: formatMoney(sel.feeFromEgp, lang) })}</p>
                <Link to={`/doctors/${sel.id}`} className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-ocean hover:underline" data-testid="map-selection-link">{t("results.viewProfile")}<ArrowUpRight className="rtl-flip h-4 w-4" aria-hidden="true" /></Link>
              </>
            ) : <p className="text-sm text-muted-foreground">{points.length ? t("map.pickHint") : t("map.noCoords")}</p>}
          </div>
          {areaChips}
        </div>
      </div>
      {missing > 0 && points.length > 0 && <p className="text-xs text-muted-foreground" data-testid="map-missing">{t("map.missing", { count: missing })}</p>}
    </section>
  );
}
