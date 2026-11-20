import { districtLabel } from "@/lib/districts";
import { useEffect, useMemo, useState } from "react";
import { List, Map as MapIcon, MapPin } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { mapSearchItem } from "@/api/adapters";
import { useSponsored } from "@/api/services";
import { useSearchDoctors, useSpecialties } from "@/api/hooks";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/states";
import { DoctorCard } from "@/components/DoctorCard";
import { FiltersSheet } from "@/components/FiltersSheet";
import { SearchBar, SpecialtyChips } from "@/components/SearchBar";
import { CareTypeTabs } from "@/components/CareTypeTabs";
import { useHomeDistricts } from "@/api/home";
import { EmergencyBanner } from "@/components/EmergencyBanner";
import { SlotTakenDialog } from "@/components/SlotTakenDialog";
import { useStartBooking } from "@/hooks/useStartBooking";
import { isEmergencyQuery } from "@/lib/emergency";
import { activeFilterCount, parseSearch, toQuery } from "@/lib/searchParams";
import { mapKeywordToSpecialty, track } from "@/lib/analytics";
import type { SearchParams } from "@/api/types";
import { PageHeader } from "@/components/kit";
import { AREAS, areaLabel } from "@/lib/areas";
import { cn } from "@/lib/utils";

type View = "list" | "map";
const SORTS: SearchParams["sort"][] = ["earliest", "distance", "rating", "fee"];

export default function ResultsPage() {
  const { t, i18n } = useTranslation();
  const [sp, setSp] = useSearchParams();
  const params = parseSearch(sp);
  const localEmergency = !!params.q && isEmergencyQuery(params.q);
  const needsDistrict = params.serviceLocation === "HOME" && !params.district; // the API answers 400 DISTRICT_REQUIRED for a home search without a district
  const { data, isLoading, isFetching, error, refetch } = useSearchDoctors(params, !localEmergency && !needsDistrict);
  const emergency = localEmergency || !!data?.emergency;
  const specialties = useSpecialties();
  const sponsored = useSponsored(!localEmergency);
  const booking = useStartBooking();
  const apply = (p: SearchParams) => setSp(toQuery(p), { replace: false });

  useEffect(() => {
    if (data) track("results_viewed", { specialtyCode: params.specialty ?? mapKeywordToSpecialty(params.q ?? "") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const [view, setView] = useState<View>("list");
  const byArea = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of data?.items ?? []) m.set(d.areaEn, (m.get(d.areaEn) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);
  const pageSize = data?.pageSize ?? 20;
  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div className="space-y-5">
      <PageHeader title={t("results.title")} hint={t("results.subtitle")} />
      <SearchBar initialQ={params.q ?? ""} key={params.q ?? ""} />
      <CareTypeTabs active={params.careType} onPick={(c) => apply({ ...params, careType: c, serviceLocation: c === "HOME_NURSING" ? "HOME" : undefined, page: 1 })} />
      <HomeFilter params={params} apply={apply} />
      <SpecialtyChips active={params.specialty} onPick={(code) => apply({ ...params, specialty: code, page: 1 })} />

      {data?.noMarketLive && <div role="status" className="rounded-xl border border-warning/50 bg-warning-soft p-4 text-sm text-warning" data-testid="no-market-live">{t("market.noneLive")}</div>}
      {emergency ? <EmergencyBanner /> : (
        <>
          <div className="sticky top-16 z-30 -mx-4 border-b bg-background/85 px-4 py-2.5 backdrop-blur-md md:rounded-xl md:border md:bg-card/85 md:px-3" data-testid="results-toolbar">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <p className="text-sm font-medium" aria-live="polite" data-testid="result-count">{data && !needsDistrict ? t("results.count", { count: data.total }) : " "}{isFetching && !isLoading && <span className="ms-2 inline-block h-2 w-2 animate-pulse rounded-full bg-pulse align-middle" aria-hidden="true" />}</p>
              <div className="flex flex-wrap items-center gap-2">
                <div role="radiogroup" aria-label={t("results.view")} className="inline-flex rounded-xl border bg-card p-0.5" data-testid="view-toggle">
                  {([["list", List, "results.viewList"], ["map", MapIcon, "results.viewMap"]] as const).map(([v, Icon, k]) => (
                    <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)} className={cn("inline-flex min-h-10 items-center gap-1.5 rounded-[10px] px-3 text-sm font-medium transition-colors", view === v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                      <Icon className="h-4 w-4" aria-hidden="true" />{t(k)}
                    </button>
                  ))}
                </div>
                <Label htmlFor="sort" className="sr-only">{t("results.sort")}</Label>
                <select id="sort" value={params.sort} onChange={(e) => apply({ ...params, sort: e.target.value as SearchParams["sort"], page: 1 })} className="h-11 rounded-xl border border-input bg-card px-3 text-sm font-medium">
                  {SORTS.map((s) => <option key={s} value={s}>{t(`sort.${s}`)}</option>)}
                </select>
                <FiltersSheet value={params} onApply={apply} activeCount={activeFilterCount(params)} />
              </div>
            </div>
          </div>

          {view === "map" && (
            <section aria-label={t("results.mapTitle")} className="kx-card grid gap-4 overflow-hidden p-0 md:grid-cols-[1.2fr_1fr]" data-testid="map-placeholder">
              <div className="relative flex min-h-44 items-center justify-center bg-accent" role="img" aria-label={t("doctor.mapPlaceholder")}>
                <svg className="absolute inset-0 h-full w-full text-border" aria-hidden="true"><defs><pattern id="mapgrid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke="currentColor" strokeWidth="1" /></pattern></defs><rect width="100%" height="100%" fill="url(#mapgrid)" /></svg>
                <div className="kx-glass relative mx-4 max-w-xs rounded-2xl p-4 text-center"><MapPin className="mx-auto mb-1 h-6 w-6 text-pulse" aria-hidden="true" /><p className="text-sm font-semibold">{t("results.mapSoonTitle")}</p><p className="mt-1 text-xs text-muted-foreground">{t("results.mapSoonBody")}</p></div>
              </div>
              <div className="space-y-2 p-4">
                <h2 className="text-sm font-semibold">{t("results.byArea")}</h2>
                {byArea.length === 0 ? <p className="text-sm text-muted-foreground">{t("results.byAreaEmpty")}</p> : (
                  <ul className="flex flex-wrap gap-2">
                    {byArea.map(([a, n]) => (
                      <li key={a}><button type="button" className="kx-chip min-h-10" aria-pressed={params.area === a} disabled={!AREAS.includes(a)} onClick={() => apply({ ...params, area: params.area === a ? undefined : a, page: 1 })}>{areaLabel(a, i18n.language)}<span className="kx-label-num text-xs text-muted-foreground">{n}</span></button></li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          {sponsored.data && sponsored.data.items.length > 0 && (
            <section aria-label={sponsored.data.label} className="space-y-3" data-testid="sponsored-section">
              {sponsored.data.items.map((i) => <DoctorCard key={`s-${i.id}`} doctor={{ ...mapSearchItem(i), sponsored: true }} specialties={specialties.data} onPickSlot={(doc, slot) => booking.start(doc.id, slot)} />)}
            </section>
          )}
          {needsDistrict ? <EmptyState title={t("hv.pickDistrictTitle")} hint={t("hv.pickDistrictHint")} /> : isLoading ? <CardSkeleton /> : error ? <ErrorState error={error} onRetry={() => void refetch()} /> : data && data.items.length === 0 ? (
            <EmptyState title={params.serviceLocation === "HOME" && params.district ? t("hv.outOfCoverageTitle") : t("results.emptyTitle")} hint={params.serviceLocation === "HOME" && params.district ? t("hv.outOfCoverageBody") : t("results.emptyHint")} action={<Button variant="outline" onClick={() => apply({ sort: params.sort })}>{t("filters.reset")}</Button>} />
          ) : (
            <div className={isFetching ? "space-y-4 opacity-70 transition-opacity" : "space-y-4"} data-testid="results-list" aria-busy={isFetching}>
              {data?.items.map((d) => <DoctorCard key={d.id} doctor={d} specialties={specialties.data} onPickSlot={(doc, slot) => booking.start(doc.id, slot)} />)}
            </div>
          )}

          {data && pages > 1 && (
            <nav className="flex items-center justify-center gap-3" aria-label={t("results.pagination")}>
              <Button variant="outline" disabled={(params.page ?? 1) <= 1} onClick={() => apply({ ...params, page: (params.page ?? 1) - 1 })}>{t("results.prev")}</Button>
              <span className="text-sm">{t("results.pageOf", { page: params.page ?? 1, pages })}</span>
              <Button variant="outline" disabled={(params.page ?? 1) >= pages} onClick={() => apply({ ...params, page: (params.page ?? 1) + 1 })}>{t("results.next")}</Button>
            </nav>
          )}
        </>
      )}
      <SlotTakenDialog alternatives={booking.alternatives} onClose={booking.clearAlternatives} onPick={(s) => { booking.clearAlternatives(); if (booking.takenDoctorId) booking.start(booking.takenDoctorId, s); }} />
    </div>
  );
}

/** KXMHV02: "At home" search by district (+ OUT_OF_COVERAGE hint when no provider covers it). */
function HomeFilter({ params, apply }: { params: SearchParams; apply: (p: SearchParams) => void }) {
  const { t, i18n } = useTranslation();
  const districts = useHomeDistricts(params.serviceLocation === "HOME" || params.careType === "HOME_NURSING");
  const home = params.serviceLocation === "HOME";
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="home-filter">
      <button type="button" className="kx-chip" aria-pressed={home} data-testid="filter-home" onClick={() => apply({ ...params, serviceLocation: home ? undefined : "HOME", district: home ? undefined : params.district, page: 1 })}>{t("hv.atHome")}</button>
      {home && (
        <>
          <Label htmlFor="district" className="sr-only">{t("hv.district")}</Label>
          <select id="district" value={params.district ?? ""} onChange={(e) => apply({ ...params, district: e.target.value || undefined, page: 1 })} className="h-11 rounded-xl border border-input bg-card px-3 text-sm" data-testid="district-select">
            <option value="">{t("hv.anyDistrict")}</option>
            {(districts.data ?? []).map((d) => <option key={d.district} value={d.district}>{districtLabel(d.district, i18n.language)} ({d.homeEnabledProviders})</option>)}
          </select>
          {districts.data && districts.data.length === 0 && <p className="text-sm text-muted-foreground" data-testid="no-districts">{t("hv.noDistricts")}</p>}
        </>
      )}
    </div>
  );
}
