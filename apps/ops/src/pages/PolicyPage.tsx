import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/api/errors";
import { useClearPolicy, usePolicies, useSetPolicy, type PolicyItem } from "@/api/policy";
import { useAuth } from "@/auth/AuthProvider";
import { isSuperAdmin } from "@/auth/RequireOps";
import { CardSkeleton, ErrorState } from "@/components/states";
import { PageHeader } from "@/components/PageHeader";
import { formatDateTime } from "@/lib/format";

const CURRENCY: Record<string, string> = { EG: "EGP", SA: "SAR", AE: "AED", KW: "KWD" };
const sel = "h-11 max-w-full rounded-xl border border-input bg-card px-3 text-sm";
const num = (v: unknown) => Number(v ?? 0);

/** Plain-language summary of a resolved value (what the market actually gets). */
function Summary({ item, market }: { item: PolicyItem; market: string }) {
  const { t } = useTranslation();
  const v = item.value;
  const cur = CURRENCY[market] ?? "";
  if (item.key === "pay.deposit_default") {
    return <p data-testid="policy-summary">{v.enabled ? t("policy.depositSummary", { percent: num(v.percentBps) / 100, cap: num(v.capMajor), currency: cur }) : t("policy.depositOff")}</p>;
  }
  if (item.key === "pharmacy.partial_fulfilment") {
    return <p data-testid="policy-summary">{t(`policy.partialMode.${String(v.mode)}`)} · {v.refundDeliveryFeeIfNotDelivered ? t("policy.feeRefunded") : t("policy.feeKept")} · {v.releaseFulfilledToPharmacy ? t("policy.released") : t("policy.heldForOps")}</p>;
  }
  return <pre className="text-xs">{JSON.stringify(v)}</pre>;
}

function Editor({ item, market, canEdit }: { item: PolicyItem; market: string; canEdit: boolean }) {
  const { t } = useTranslation();
  const set = useSetPolicy(); const clear = useClearPolicy();
  const v = item.value;
  const [draft, setDraft] = useState<Record<string, unknown>>(v);
  const marketOverride = item.overrides.some((o) => o.scope === "MARKET" && o.scopeId === market);
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? `${e.code}: ${e.message}` : t("states.errorTitle"));
  const save = () => set.mutate({ key: item.key, scope: "MARKET", scopeId: market, value: draft }, { onSuccess: () => toast.success(t("policy.saved")), onError: fail });
  const reset = () => clear.mutate({ key: item.key, scope: "MARKET", scopeId: market }, { onSuccess: () => toast.success(t("policy.cleared")), onError: fail });
  const ch = (k: string, val: unknown) => setDraft((d) => ({ ...d, [k]: val }));
  return (
    <div className="mt-3 space-y-3 border-t pt-3" data-testid={`policy-editor-${item.key}`}>
      {item.key === "pay.deposit_default" && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!draft.enabled} disabled={!canEdit} onChange={(e) => ch("enabled", e.target.checked)} data-testid="dep-enabled" />{t("policy.enabled")}</label>
          <div className="space-y-1"><Label htmlFor={`pct-${item.key}`}>{t("policy.percent")}</Label><Input id={`pct-${item.key}`} type="number" min={0} max={100} step={0.5} className="w-28" disabled={!canEdit} value={num(draft.percentBps) / 100} onChange={(e) => ch("percentBps", Math.round(Number(e.target.value) * 100))} data-testid="dep-percent" /></div>
          <div className="space-y-1"><Label htmlFor={`cap-${item.key}`}>{t("policy.cap", { currency: CURRENCY[market] ?? "" })}</Label><Input id={`cap-${item.key}`} type="number" min={0} className="w-32" disabled={!canEdit} value={num(draft.capMajor)} onChange={(e) => ch("capMajor", Math.round(Number(e.target.value)))} data-testid="dep-cap" /></div>
        </div>
      )}
      {item.key === "pharmacy.partial_fulfilment" && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 max-w-full space-y-1"><Label htmlFor={`mode-${item.key}`}>{t("policy.mode")}</Label><select id={`mode-${item.key}`} className={sel} disabled={!canEdit} value={String(draft.mode)} onChange={(e) => ch("mode", e.target.value)} data-testid="partial-mode"><option value="PRO_RATA_REFUND">{t("policy.partialMode.PRO_RATA_REFUND")}</option><option value="MANUAL_REVIEW">{t("policy.partialMode.MANUAL_REVIEW")}</option></select></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!draft.refundDeliveryFeeIfNotDelivered} disabled={!canEdit} onChange={(e) => ch("refundDeliveryFeeIfNotDelivered", e.target.checked)} />{t("policy.feeRefunded")}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!draft.releaseFulfilledToPharmacy} disabled={!canEdit} onChange={(e) => ch("releaseFulfilledToPharmacy", e.target.checked)} />{t("policy.released")}</label>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!canEdit || set.isPending} onClick={save} data-testid="policy-save">{t("policy.save", { market })}</Button>
        {marketOverride && <Button size="sm" variant="outline" disabled={!canEdit || clear.isPending} onClick={reset} data-testid="policy-reset"><RotateCcw aria-hidden="true" />{t("policy.reset")}</Button>}
        {!canEdit && <span className="text-xs text-muted-foreground">{t("policy.superAdminOnly")}</span>}
      </div>
    </div>
  );
}

/** Market policy: the business defaults delegated by the founder on 23 Nov 2026 (PROPOSED_DEFAULT), their source, and per-market / per-organisation overrides. Super admin edits; every change is audited. */
export default function PolicyPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("ar") ? "ar" : "en";
  const [market, setMarket] = useState("EG");
  const q = usePolicies(market);
  const { user } = useAuth();
  const canEdit = !!user && isSuperAdmin(user.roles);
  return (
    <div className="space-y-5">
      <PageHeader title={t("policy.title")} hint={t("policy.hint")} />
      <div className="space-y-1"><Label htmlFor="pol-m">{t("flags.market")}</Label><Input id="pol-m" value={market} onChange={(e) => setMarket(e.target.value.toUpperCase().slice(0, 2))} className="w-20" dir="ltr" maxLength={2} /></div>
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data && (
        <ul className="space-y-4" data-testid="policy-list">
          {q.data.items.map((item) => (
            <li key={`${market}-${item.key}-${JSON.stringify(item.value)}`} className="kx-card p-5" data-testid={`policy-${item.key}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><h2 className="text-lg">{lang === "ar" ? item.titleAr : item.titleEn}</h2><code className="text-xs text-muted-foreground" dir="ltr">{item.key}</code></div>
                {item.proposedDefault
                  ? <Badge variant="warning" data-testid="proposed-default" title={item.note ?? undefined}>{t("policy.proposedDefault")}</Badge>
                  : <Badge variant="info" data-testid="policy-source">{t(`policy.source.${item.source}`)}</Badge>}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{lang === "ar" ? item.descriptionAr : item.descriptionEn}</p>
              <div className="mt-3 text-sm font-medium"><Summary item={item} market={market} /></div>
              {item.proposedDefault && <p className="mt-1 text-xs text-muted-foreground" data-testid="proposed-note">{item.note}</p>}
              {item.overrides.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground" data-testid="policy-overrides">
                  {item.overrides.map((o) => <li key={`${o.scope}:${o.scopeId}`}><b>{o.scope}{o.scopeId ? `:${o.scopeId}` : ""}</b> · {JSON.stringify(o.value)} · {o.updatedBy} · {formatDateTime(o.updatedAt, i18n.language)}</li>)}
                </ul>
              )}
              <Editor item={item} market={market} canEdit={canEdit} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
