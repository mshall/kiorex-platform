import { districtLabel } from "@/lib/districts";
import { useEffect } from "react";
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

const SORTS: SearchParams["sort"][] = ["earliest", "distance", "rating", "fee"];

export default function ResultsPage() {
  const { t } = useTranslation();
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

  const pageSize = data?.pageSize ?? 20;
  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl">{t("results.title")}</h1>
      <SearchBar initialQ={params.q ?? ""} key={params.q ?? ""} />
      <CareTypeTabs active={params.careType} onPick={(c) => apply({ ...params, careType: c, serviceLocation: c === "HOME_NURSING" ? "HOME" : undefined, page: 1 })} />
      <HomeFilter params={params} apply={apply} />
      <SpecialtyChips active={params.specialty} onPick={(code) => apply({ ...params, specialty: code, page: 1 })} />

      {data?.noMarketLive && <div role="status" className="rounded-xl border border-warning/50 bg-warning-soft p-4 text-sm text-warning" data-testid="no-market-live">{t("market.noneLive")}</div>}
      {emergency ? <EmergencyBanner /> : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <p className="text-sm text-muted-foreground" aria-live="polite" data-testid="result-count">{data && !needsDistrict ? t("results.count", { count: data.total }) : " "}</p>
            <div className="flex items-end gap-2">
              <div>
                <Label htmlFor="sort" className="sr-only">{t("results.sort")}</Label>
                <select id="sort" value={params.sort} onChange={(e) => apply({ ...params, sort: e.target.value as SearchParams["sort"], page: 1 })} className="h-11 rounded-xl border border-input bg-card px-3 text-sm">
                  {SORTS.map((s) => <option key={s} value={s}>{t(`sort.${s}`)}</option>)}
                </select>
              </div>
              <FiltersSheet value={params} onApply={apply} activeCount={activeFilterCount(params)} />
            </div>
          </div>

          {sponsored.data && sponsored.data.items.length > 0 && (
            <section aria-label={sponsored.data.label} className="space-y-3" data-testid="sponsored-section">
              {sponsored.data.items.map((i) => <DoctorCard key={`s-${i.id}`} doctor={{ ...mapSearchItem(i), sponsored: true }} specialties={specialties.data} onPickSlot={(doc, slot) => booking.start(doc.id, slot)} />)}
            </section>
          )}
          {needsDistrict ? <EmptyState title={t("hv.pickDistrictTitle")} hint={t("hv.pickDistrictHint")} /> : isLoading ? <CardSkeleton /> : error ? <ErrorState error={error} onRetry={() => void refetch()} /> : data && data.items.length === 0 ? (
            <EmptyState title={params.serviceLocation === "HOME" && params.district ? t("hv.outOfCoverageTitle") : t("results.emptyTitle")} hint={params.serviceLocation === "HOME" && params.district ? t("hv.outOfCoverageBody") : t("results.emptyHint")} action={<Button variant="outline" onClick={() => apply({ sort: params.sort })}>{t("filters.reset")}</Button>} />
          ) : (
            <div className={isFetching ? "space-y-4 opacity-70 transition-opacity" : "space-y-4"} data-testid="results-list">
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
