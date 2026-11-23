import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { localizeAddressSummary } from "@/lib/districts";
import { toast } from "sonner";
import { MapPin, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAddresses, useConfirmAddress, type Address } from "@/api/home";
import { CardSkeleton, ErrorState } from "@/components/states";
import { cn } from "@/lib/utils";

export const covers = (districts: string[], district: string) => districts.length === 0 || districts.includes(district);

/** KXMHV02/03: choose the visit address from the address book. Only the masked one-line summary is shown here; doorstep lines never leave the address screen. */
export function HomeVisitPicker({ coverageDistricts, value, onChange }: { coverageDistricts: string[]; value?: string; onChange: (a: Address | undefined) => void }) {
  const { t, i18n } = useTranslation();
  const q = useAddresses();
  const confirm = useConfirmAddress();
  const list = useMemo(() => q.data ?? [], [q.data]);
  const chosen = list.find((a) => a.id === value);
  useEffect(() => {
    if (!list.length) { if (value) onChange(undefined); return; }
    if (!chosen) onChange(list.find((a) => a.isDefault) ?? list[0]);
  }, [list, chosen, value, onChange]);

  if (q.isLoading) return <CardSkeleton rows={1} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (list.length === 0) return (
    <div className="kx-card space-y-2 p-5" data-testid="no-addresses"><p className="font-medium">{t("hv.noAddressTitle")}</p><p className="text-sm text-muted-foreground">{t("hv.noAddressHint")}</p>
      <Link to="/account/addresses" className="inline-flex min-h-11 items-center text-ocean underline underline-offset-4">{t("hv.addAddress")}</Link></div>
  );
  const out = chosen ? !covers(coverageDistricts, chosen.district) : false;
  return (
    <div className="space-y-3" data-testid="home-picker">
      <div role="radiogroup" aria-label={t("hv.visitAddress")} className="grid gap-2 sm:grid-cols-2">
        {list.map((a) => (
          <button key={a.id} type="button" role="radio" aria-checked={a.id === value} onClick={() => onChange(a)} data-testid="address-option"
            className={cn("flex min-h-14 items-start gap-2 rounded-xl border p-3 text-start", a.id === value ? "border-primary bg-accent" : "bg-card hover:bg-accent")}>
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ocean" aria-hidden="true" /><span className="text-sm"><b>{a.label}</b><br /><span className="text-muted-foreground">{localizeAddressSummary(a.summary, i18n.language)}</span></span>
          </button>
        ))}
      </div>
      <Link to="/account/addresses" className="inline-flex min-h-11 items-center text-sm text-ocean underline underline-offset-4">{t("hv.manageAddresses")}</Link>
      {chosen && !chosen.confirmed && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/50 bg-warning-soft p-3 text-sm" data-testid="address-unconfirmed">
          <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-warning" aria-hidden="true" />{t("hv.unconfirmed")}</span>
          <Button size="sm" disabled={confirm.isPending} data-testid="confirm-address" onClick={() => confirm.mutate(chosen.id, { onSuccess: () => toast.success(t("hv.confirmed")), onError: () => toast.error(t("states.errorTitle")) })}>{t("hv.confirmAddress")}</Button>
        </div>
      )}
      {out && (
        <div role="alert" className="flex gap-3 rounded-xl border border-destructive/40 bg-card p-4" data-testid="out-of-coverage">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          <div><p className="font-semibold">{t("hv.outOfCoverageTitle")}</p><p className="text-sm">{t("hv.outOfCoverageBody")}</p></div>
        </div>
      )}
    </div>
  );
}
