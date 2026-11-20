import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAddresses, useCarePlans, useCreateCarePlan } from "@/api/home";
import { useSearchDoctors } from "@/api/hooks";
import { ApiError } from "@/api/errors";
import { CardSkeleton, EmptyState, ErrorState, UnavailableState } from "@/components/states";
import { useFeature } from "@/hooks/useFeature";
import { formatDay, pick } from "@/lib/format";

const STATUS_VARIANT = { REQUESTED: "warning", CONFIRMED: "success", ENDED: "secondary", REJECTED: "secondary" } as const;

/** KXMHV08 (P3, draft): request a recurring nurse care plan. Locked until nurse.care_plans (GKN1) AND kiorex.home_visits are effective: the API answers 403 FEATURE_DISABLED and we show "awaiting approval". */
export default function CarePlansPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const home = useFeature("kiorex.home_visits");
  const plans = useCarePlans();
  const addrs = useAddresses();
  const nurses = useSearchDoctors({ careType: "HOME_NURSING", sort: "rating" });
  const create = useCreateCarePlan();
  const [providerId, setProviderId] = useState(""); const [addressId, setAddressId] = useState(""); const [start, setStart] = useState(""); const [notes, setNotes] = useState("");
  const [locked, setLocked] = useState<{ awaiting: boolean } | null>(null);
  const lockedFromList = plans.error instanceof ApiError && plans.error.isFeatureDisabled ? { awaiting: plans.error.isAwaitingApproval } : null;
  const lock = locked ?? lockedFromList ?? (!home.enabled ? { awaiting: home.awaiting } : null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ providerId, addressId, ...(start ? { preferredStartDate: start } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) }, {
      onSuccess: () => { toast.success(t("hv.planRequested")); setNotes(""); },
      onError: (err) => { if (err instanceof ApiError && err.isFeatureDisabled) setLocked({ awaiting: err.isAwaitingApproval }); else if (err instanceof ApiError && err.code === "OUT_OF_COVERAGE") toast.error(t("hv.outOfCoverageTitle")); else toast.error(t("states.errorTitle")); },
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/account" className="inline-flex min-h-11 items-center gap-2 text-sm text-ocean underline underline-offset-4"><ArrowLeft className="h-4 w-4 rtl-flip" aria-hidden="true" />{t("nav.account")}</Link>
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl">{t("hv.carePlans")}</h1><Badge variant="info">{t("hv.draftBadge")}</Badge></div>
      <p className="text-sm text-muted-foreground">{t("hv.carePlansIntro")}</p>
      {lock ? <UnavailableState featureKey="nurse.care_plans" awaiting={lock.awaiting} /> : (
        <form onSubmit={submit} className="kx-card space-y-3 p-5" aria-label={t("hv.planRequest")} data-testid="plan-form">
          <h2 className="text-lg">{t("hv.planRequest")}</h2>
          <div className="space-y-1"><Label htmlFor="cp-prov">{t("hv.planProvider")}</Label>
            <select id="cp-prov" value={providerId} onChange={(e) => setProviderId(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm" data-testid="plan-provider">
              <option value="">{t("hv.choose")}</option>{(nurses.data?.items ?? []).map((n) => <option key={n.id} value={n.id}>{pick(n, "name", lang)}</option>)}</select>
            {nurses.data && nurses.data.items.length === 0 && <p className="text-xs text-muted-foreground">{t("hv.noNurses")}</p>}</div>
          <div className="space-y-1"><Label htmlFor="cp-addr">{t("hv.visitAddress")}</Label>
            <select id="cp-addr" value={addressId} onChange={(e) => setAddressId(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm" data-testid="plan-address">
              <option value="">{t("hv.choose")}</option>{(addrs.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.label} · {a.summary}</option>)}</select>
            {addrs.data && addrs.data.length === 0 && <Link to="/account/addresses" className="text-xs text-ocean underline underline-offset-4">{t("hv.addAddress")}</Link>}</div>
          <div className="space-y-1"><Label htmlFor="cp-start">{t("hv.planStart")}</Label><Input id="cp-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="cp-notes">{t("hv.planNotes")}</Label><Textarea id="cp-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} /></div>
          <Button type="submit" disabled={!providerId || !addressId || create.isPending} data-testid="plan-submit">{t("hv.planSubmit")}</Button>
        </form>
      )}
      <h2 className="text-lg">{t("hv.myPlans")}</h2>
      {plans.isLoading ? <CardSkeleton rows={1} /> : lockedFromList ? null : plans.error ? <ErrorState error={plans.error} onRetry={() => void plans.refetch()} /> : plans.data!.length === 0 ? (
        <EmptyState icon={<ClipboardList className="h-10 w-10" aria-hidden="true" />} title={t("hv.noPlans")} />
      ) : (
        <ul className="space-y-3">{plans.data!.map((p) => (
          <li key={p.id} className="kx-card space-y-1 p-4" data-testid="plan-row"><div className="flex items-center justify-between"><p className="font-medium">{p.district}</p><Badge variant={STATUS_VARIANT[p.status]}>{t(`hv.planStatus.${p.status}`)}</Badge></div>
            <p className="text-sm text-muted-foreground">{t("hv.planVisits", { done: p.completedVisits, total: p.visits.length })}{p.visits[0] && ` · ${formatDay(p.visits[0].startsAt, lang)}`}</p></li>
        ))}</ul>
      )}
    </div>
  );
}
