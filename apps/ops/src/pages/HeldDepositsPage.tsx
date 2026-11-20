import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Banknote, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHeldDeposits, useReviewDeposit, type HeldDeposit } from "@/api/home";
import { ApiError } from "@/api/errors";
import { CardSkeleton, ErrorState } from "@/components/states";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { formatDateTime, formatMinor } from "@/lib/format";

/** KXMPAY07: deposits of unsafe-aborted home visits are held for ops review and never auto-forfeited. A human decides: release to the provider, or refund the patient. Reason is mandatory and audited. */
export default function HeldDepositsPage() {
  const { t, i18n } = useTranslation();
  const q = useHeldDeposits();
  const review = useReviewDeposit();
  const [target, setTarget] = useState<{ row: HeldDeposit; decision: "release" | "refund" } | null>(null);
  const [reason, setReason] = useState("");
  const close = () => { setTarget(null); setReason(""); };
  return (
    <div>
      <PageHeader title={t("held.title")} hint={t("held.hint")} />
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <DataTable caption={t("held.title")} rows={q.data!} rowKey={(r) => r.paymentId} empty={t("held.none")} columns={[
          { key: "b", header: t("held.booking"), cell: (r) => <code className="text-xs" dir="ltr">{r.bookingId ?? "—"}</code> },
          { key: "a", header: t("held.amount"), cell: (r) => <b className="kx-label-num">{formatMinor(r.amountMinor, i18n.language, r.currency)}</b> },
          { key: "d", header: t("held.district"), cell: (r) => r.district ?? "—" },
          { key: "x", header: t("held.reason"), cell: (r) => <Badge variant="warning">{r.reason ?? "UNSAFE_ABORT"}</Badge> },
          { key: "t", header: t("held.age"), cell: (r) => <div className="whitespace-nowrap text-xs">{formatDateTime(r.heldForReviewAt, i18n.language)}<br />{r.ageHours != null ? t("held.ageHours", { h: Math.round(r.ageHours) }) : ""}</div> },
          { key: "z", header: "", cell: (r) => (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setTarget({ row: r, decision: "release" })} data-testid={`release-${r.paymentId}`}><Banknote aria-hidden="true" />{t("held.release")}</Button>
              <Button size="sm" variant="outline" onClick={() => setTarget({ row: r, decision: "refund" })} data-testid={`refund-${r.paymentId}`}><Undo2 aria-hidden="true" />{t("held.refund")}</Button>
            </div>) },
        ]} />
      )}
      {target && (
        <Dialog open onOpenChange={(o) => !o && close()}>
          <DialogContent data-testid="review-dialog">
            <DialogHeader><DialogTitle>{t(`held.${target.decision}Title`)}</DialogTitle><DialogDescription>{t(`held.${target.decision}Body`, { amount: formatMinor(target.row.amountMinor, i18n.language, target.row.currency) })}</DialogDescription></DialogHeader>
            <div className="space-y-1"><Label htmlFor="rv-reason">{t("held.reasonLabel")} *</Label><Input id="rv-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-testid="review-reason" /></div>
            <DialogFooter><Button variant="outline" onClick={close}>{t("common.cancel")}</Button>
              <Button disabled={!reason.trim() || review.isPending} data-testid="review-confirm"
                onClick={() => review.mutate({ paymentId: target.row.paymentId, decision: target.decision, reason: reason.trim() }, { onSuccess: () => { toast.success(t("held.done")); close(); }, onError: (e) => toast.error(e instanceof ApiError ? `${e.code}: ${e.message}` : t("states.errorTitle")) })}>{t(`held.${target.decision}`)}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
