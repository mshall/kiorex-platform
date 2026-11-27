import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/api/errors";
import { useCreateEnrolment, useEnrolments, useRevokeEnrolment, type EnrolmentCreated } from "@/api/partnerEnrolments";
import { StatusChip, type Tone } from "@/components/kit";
import { formatDateTime } from "@/lib/format";

const TONE: Record<string, Tone> = { ACTIVE: "info", USED: "success", REVOKED: "danger", EXPIRED: "neutral" };
const KINDS = ["CLINIC", "NURSE", "PHARMACY", "LAB"] as const;

/** One-time enrolment codes: a partner product needs one to submit its first connection request (contracts 1.9.0). The code is shown once, here, right after creation. */
export function EnrolmentCodesPanel({ prefill }: { prefill?: { kind?: (typeof KINDS)[number] | null; label?: string } } = {}) {
  const { t, i18n } = useTranslation(); const q = useEnrolments(); const create = useCreateEnrolment(); const revoke = useRevokeEnrolment();
  const [kind, setKind] = useState<(typeof KINDS)[number]>(prefill?.kind ?? "PHARMACY"); const [label, setLabel] = useState((prefill?.label ?? "").slice(0, 120)); const [orgRef, setOrgRef] = useState(""); const [days, setDays] = useState("7");
  const [shown, setShown] = useState<EnrolmentCreated | null>(null);
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? t(`pob.err.${e.code}`, { defaultValue: e.message }) : String(e));
  const submit = () => create.mutate({ kind, label: label.trim(), ...(orgRef.trim() ? { orgRef: orgRef.trim() } : {}), ttlHours: Math.max(1, Math.min(14, Number(days) || 7)) * 24 }, { onSuccess: (r) => { setShown(r); setLabel(""); setOrgRef(""); }, onError: fail });
  return (
    <section className="mb-6 rounded-2xl border bg-card p-4" data-testid="pob-enrolments" aria-labelledby="pob-enrol-title">
      <h2 id="pob-enrol-title" className="flex items-center gap-2 text-base font-semibold"><KeyRound className="h-4 w-4" aria-hidden="true" />{t("pob.enrol.title")}</h2>
      <p className="mb-3 text-sm text-muted-foreground">{t("pob.enrol.hint")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">{t("pob.enrol.kind")}
          <select className="mt-1 block h-9 rounded-md border border-input bg-background px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} data-testid="enrol-kind">{KINDS.map((k) => <option key={k} value={k}>{t(`pob.kind.${k}`)}</option>)}</select>
        </label>
        <label className="text-sm">{t("pob.enrol.label")}<Input className="mt-1 w-56" dir="auto" value={label} onChange={(e) => setLabel(e.target.value)} data-testid="enrol-label" /></label>
        <label className="text-sm">{t("pob.enrol.orgRef")}<Input className="mt-1 w-44" dir="ltr" value={orgRef} onChange={(e) => setOrgRef(e.target.value)} /></label>
        <label className="text-sm">{t("pob.enrol.days")}<Input className="mt-1 w-20" dir="ltr" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></label>
        <Button disabled={create.isPending || label.trim().length < 2} onClick={submit} data-testid="enrol-create">{t("pob.enrol.create")}</Button>
      </div>
      {shown ? (
        <div role="status" className="mt-3 rounded-xl border border-warning/40 bg-warning/10 p-3" data-testid="enrol-once">
          <p className="text-sm font-medium">{t("pob.enrol.once")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2"><code className="break-all rounded bg-muted px-2 py-1 text-xs" dir="ltr" data-testid="enrol-code">{shown.code}</code>
            <Button size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(shown.code).then(() => toast.success(t("pob.enrol.copied")))}><Copy className="h-3.5 w-3.5" aria-hidden="true" />{t("pob.enrol.copy")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setShown(null)}>{t("pob.enrol.hide")}</Button></div>
        </div>
      ) : null}
      {q.data?.length ? (
        <table className="mt-3 w-full text-sm"><caption className="sr-only">{t("pob.enrol.title")}</caption>
          <thead><tr className="text-start text-xs text-muted-foreground"><th className="text-start font-medium">{t("pob.enrol.kind")}</th><th className="text-start font-medium">{t("pob.enrol.label")}</th><th className="text-start font-medium">{t("pob.status")}</th><th className="text-start font-medium">{t("pob.enrol.expires")}</th><th /></tr></thead>
          <tbody>{q.data.slice(0, 20).map((r) => (
            <tr key={r.id} className="border-t" data-testid={`enrol-row-${r.id}`}>
              <td className="py-1.5">{t(`pob.kind.${r.kind}`)}</td><td dir="auto">{r.label}{r.orgRef ? <span className="ms-2 text-xs text-muted-foreground" dir="ltr">{r.orgRef}</span> : null}</td>
              <td><StatusChip tone={TONE[r.status] ?? "neutral"}>{t(`pob.enrol.st.${r.status}`)}</StatusChip></td>
              <td className="whitespace-nowrap text-xs">{formatDateTime(r.expiresAt, i18n.language)}</td>
              <td className="text-end">{r.status === "ACTIVE" ? <Button size="sm" variant="outline" disabled={revoke.isPending} onClick={() => revoke.mutate(r.id, { onError: fail })} data-testid={`enrol-revoke-${r.id}`}>{t("pob.enrol.revoke")}</Button> : null}</td>
            </tr>))}</tbody></table>
      ) : <p className="mt-3 text-sm text-muted-foreground">{t("pob.enrol.none")}</p>}
    </section>
  );
}
