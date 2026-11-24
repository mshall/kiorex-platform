import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError } from "@/api/errors";
import { useGrowthAccess } from "@/api/growth";
import { type ReviewDecisionKey, type ReviewKind, useSponsoredDecision, useSponsoredDetail } from "@/api/sponsoredPromotions";
import { FormField, StatusChip } from "@/components/kit";
import { CardSkeleton, ErrorState } from "@/components/states";
import { GrowthPage, Section } from "@/components/growth/GrowthPage";
import { fmtN } from "@/lib/growthFormat";
import { formatDateTime } from "@/lib/format";

const btn = "inline-flex h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold disabled:opacity-50";

/** One promotion in review: the exact public text the patient would read (both languages), the rules, the automated guard result, and the decision per review kind (maker-checker enforced by the server). */
export default function PromotionReviewPage() {
  const { id = "" } = useParams(); const { t, i18n } = useTranslation(); const q = useSponsoredDetail(id); const dec = useSponsoredDecision(); const access = useGrowthAccess().data?.capabilities;
  const [note, setNote] = useState(""); const [msg, setMsg] = useState<string | null>(null);
  const d = q.data; const canDecide = !!access?.manage; // Super Admin (manage); a growth admin is allowed by the server as well
  const run = (kind: ReviewKind, decision: ReviewDecisionKey) => { if (!d) return; setMsg(null); dec.mutate({ id, version: d.version, kind, decision, note: note.trim() || undefined }, { onSuccess: () => { toast.success(t(`growth.sponsored.decided.${decision}`)); setNote(""); }, onError: (e) => setMsg(e instanceof ApiError ? t(`growth.sponsored.errors.${(e as { code?: string }).code ?? "generic"}`, { defaultValue: t("growth.sponsored.errors.generic") }) : t("growth.sponsored.errors.generic")) }); };
  return (
    <GrowthPage section="sponsored-promotions">
      <Link to="/growth/sponsored-promotions" className="text-sm font-semibold text-primary hover:underline">{t("growth.sponsored.back")}</Link>
      {q.isLoading ? <CardSkeleton rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !d ? null : (
        <>
          <Section title={t("growth.sponsored.patientText")} id="sp-text" hint={t("growth.sponsored.patientTextHint")}>
            <div className="grid gap-3 md:grid-cols-2" data-testid="sponsored-text">
              <div className="rounded-xl border bg-card p-3" dir="ltr"><p className="font-semibold">{d.nameEn}</p><p className="text-sm">{d.patientCopyEn}</p></div>
              <div className="rounded-xl border bg-card p-3" dir="rtl"><p className="font-semibold">{d.nameAr}</p><p className="text-sm">{d.patientCopyAr}</p></div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t("growth.sponsored.sponsorLine")}</p>
          </Section>
          <Section title={t("growth.sponsored.rules")} id="sp-rules">
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2" data-testid="sponsored-facts">
              <div><dt className="text-muted-foreground">{t("growth.sponsored.colStatus")}</dt><dd><StatusChip tone={d.status === "ACTIVE" ? "success" : "info"}>{t(`growth.sponsored.status.${d.status}`, d.status)}</StatusChip></dd></div>
              <div><dt className="text-muted-foreground">{t("growth.sponsored.colOrg")}</dt><dd><code className="text-xs" dir="ltr">{d.orgRef}</code></dd></div>
              <div><dt className="text-muted-foreground">{t("growth.sponsored.discount")}</dt><dd className="tabular-nums" data-testid="sponsored-discount">{d.discount.kind === "PERCENT_BP" ? `${fmtN((d.discount.value ?? 0) / 100)}%` : fmtN(Math.round((d.discount.value ?? 0) / 100))}</dd></div>
              <div><dt className="text-muted-foreground">{t("growth.sponsored.colBudget")}</dt><dd className="tabular-nums" data-testid="sponsored-budget">{fmtN(Math.round(d.budgetCapMinor / 100))}</dd></div>
              <div><dt className="text-muted-foreground">{t("growth.sponsored.window")}</dt><dd>{d.startsAt ? formatDateTime(d.startsAt, i18n.language) : "—"} → {d.endsAt ? formatDateTime(d.endsAt, i18n.language) : "—"}</dd></div>
              <div><dt className="text-muted-foreground">{t("growth.sponsored.careTypes")}</dt><dd>{(d.scope.careTypes ?? []).map((c) => t(`growth.sponsored.care.${c}`, c)).join(", ") || "—"}</dd></div>
              <div><dt className="text-muted-foreground">{t("growth.sponsored.highValue")}</dt><dd data-testid="sponsored-highvalue">{d.highValue.length ? <StatusChip tone="warning">{t("growth.sponsored.secondApprover")}</StatusChip> : t("growth.sponsored.no")}</dd></div>
            </dl>
          </Section>
          <Section title={t("growth.sponsored.guard")} id="sp-guard" hint={t("growth.sponsored.guardHint")}>
            <p data-testid="sponsored-guard"><StatusChip tone={d.guard.ok ? "success" : "danger"}>{d.guard.ok ? t("growth.sponsored.guardOk") : t("growth.sponsored.guardBlocked")}</StatusChip></p>
            {d.guard.hits.length ? <ul className="mt-2 list-disc space-y-1 ps-5 text-sm" data-testid="sponsored-hits">{d.guard.hits.map((h, i) => <li key={i}><StatusChip tone={h.severity === "BLOCK" ? "danger" : "warning"} dot={false}>{h.severity}</StatusChip> <code dir="ltr">{h.term}</code></li>)}</ul> : null}
          </Section>
          <Section title={t("growth.sponsored.decisions")} id="sp-decisions" hint={t("growth.sponsored.decisionsHint")}>
            {!canDecide ? <p className="text-sm text-muted-foreground" data-testid="sponsored-readonly">{t("growth.sponsored.readOnly")}</p> : null}
            <div className="space-y-3">
              {d.reviews.map((r) => (
                <div key={r.id} className="rounded-xl border bg-card p-3" data-testid={`review-${r.kind}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2"><strong>{t(`growth.sponsored.kind.${r.kind}`)}</strong><StatusChip tone={r.decision === "APPROVED" ? "success" : r.decision === "REJECTED" ? "danger" : r.decision ? "warning" : "neutral"}>{r.decision ? t(`growth.sponsored.decision.${r.decision}`) : t("growth.sponsored.pending")}</StatusChip></div>
                  {r.reason ? <p className="mt-1 text-sm text-muted-foreground">{r.reason}</p> : null}
                  {canDecide && !r.decision && d.status === "IN_REVIEW" ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className={`${btn} bg-primary text-primary-foreground`} disabled={dec.isPending} onClick={() => run(r.kind, "APPROVED")} data-testid={`approve-${r.kind}`}>{t("growth.sponsored.approve")}</button>
                      <button type="button" className={`${btn} border hover:bg-accent`} disabled={dec.isPending} onClick={() => run(r.kind, "NEEDS_CHANGES")} data-testid={`changes-${r.kind}`}>{t("growth.sponsored.needsChanges")}</button>
                      <button type="button" className={`${btn} border border-destructive/50 text-destructive hover:bg-accent`} disabled={dec.isPending} onClick={() => run(r.kind, "REJECTED")} data-testid={`reject-${r.kind}`}>{t("growth.sponsored.reject")}</button>
                    </div>) : null}
                </div>
              ))}
              {canDecide && d.status === "IN_REVIEW" ? <FormField label={t("growth.sponsored.note")} hint={t("growth.sponsored.noteHint")}><input className="h-11 w-full max-w-xl rounded-xl border bg-card px-3 text-sm" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} data-testid="sponsored-note-input" /></FormField> : null}
              {msg ? <p role="alert" className="text-sm text-[hsl(var(--danger-text))]" data-testid="sponsored-error">{msg}</p> : null}
            </div>
            <Link to={`/growth/sponsored-promotions/${encodeURIComponent(id)}/ledger`} className="mt-3 inline-block text-sm font-semibold text-primary hover:underline" data-testid="sponsored-ledger-link">{t("growth.sponsored.ledger")}</Link>
          </Section>
        </>
      )}
    </GrowthPage>
  );
}
