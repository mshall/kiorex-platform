import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError } from "@/api/errors";
import { useRewardActions } from "@/api/referrals";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/kit";

const SUB = /^[A-Za-z0-9_.:@|-]{3,128}$/;
const field = "h-11 w-full rounded-xl border bg-card px-3 text-sm";

/** Manual issuance (goodwill, compensation): a reason is required, the amount is capped per actor per day and above the threshold a SECOND approver confirms (the server decides; this dialog says what happened). */
export function ManualIssueDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation(); const { manualIssue } = useRewardActions();
  const [sub, setSub] = useState(""); const [egp, setEgp] = useState(""); const [reason, setReason] = useState(""); const [ticket, setTicket] = useState(""); const [err, setErr] = useState<string | null>(null);
  const minor = Math.round(Number(egp.replace(/[^\d.]/g, "")) * 100);
  const valid = SUB.test(sub.trim()) && Number.isInteger(minor) && minor > 0 && reason.trim().length >= 5;
  const submit = () => { setErr(null); manualIssue.mutate({ sub: sub.trim(), amountMinor: minor, reason: reason.trim(), ticketRef: ticket.trim() || undefined }, {
    onSuccess: (r) => { toast.success((r as { pending?: boolean; approvalId?: string }).approvalId || (r as { pending?: boolean }).pending ? t("growth.rewards.manual.pending") : t("growth.rewards.manual.issued")); onOpenChange(false); setSub(""); setEgp(""); setReason(""); setTicket(""); },
    onError: (e) => setErr(e instanceof ApiError ? t(`growth.rewards.err.${e.code}`, { defaultValue: e.message }) : t("states.errorTitle")) }); };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="manual-issue">
        <DialogHeader><DialogTitle>{t("growth.rewards.manual.title")}</DialogTitle><DialogDescription>{t("growth.rewards.manual.hint")}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <FormField label={t("growth.rewards.manual.patient")} hint={t("growth.rewards.manual.patientHint")}><input className={field} dir="ltr" value={sub} onChange={(e) => setSub(e.target.value)} data-testid="mi-sub" autoComplete="off" /></FormField>
          <FormField label={t("growth.rewards.manual.amount")}><input className={field} inputMode="decimal" dir="ltr" value={egp} onChange={(e) => setEgp(e.target.value)} data-testid="mi-amount" /></FormField>
          <FormField label={t("growth.rewards.manual.reason")} required><input className={field} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="mi-reason" /></FormField>
          <FormField label={t("growth.rewards.manual.ticket")}><input className={field} dir="ltr" maxLength={80} value={ticket} onChange={(e) => setTicket(e.target.value)} data-testid="mi-ticket" /></FormField>
          {err && <p role="alert" className="text-sm text-destructive" data-testid="mi-error">{err}</p>}
          <div className="flex justify-end gap-2"><button type="button" className="inline-flex h-11 items-center rounded-xl border px-4 text-sm font-semibold hover:bg-accent" onClick={() => onOpenChange(false)}>{t("growth.common.cancel")}</button>
            <button type="button" className="inline-flex h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={!valid || manualIssue.isPending} onClick={submit} data-testid="mi-submit">{t("growth.rewards.manual.submit")}</button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
