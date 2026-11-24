import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Briefcase, ShieldCheck } from "lucide-react";
import { ApiError } from "@/api/errors";
import { cleanCorporateCode, useCorporateMe, useJoinCorporate, useLeaveCorporate } from "@/api/corporate";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/kit";
import { CardSkeleton, ErrorState, UnavailableState } from "@/components/states";
import { formatMinor, formatDate } from "@/lib/format";

const KNOWN = ["CORPORATE_CODE_INVALID", "CORPORATE_CODE_EXPIRED", "CORPORATE_CODE_EXHAUSTED", "CORPORATE_NOT_ELIGIBLE", "CORPORATE_ALREADY_MEMBER", "CORPORATE_ACCOUNT_NOT_ACTIVE", "CORPORATE_EMAIL_NOT_VERIFIED"];

/**
 * `/corporate`: join a company programme with a code (or a verified work e-mail), see my own allowance, and leave at any time (GRW-P4-C). The page shows MY allowance as a usage figure, never a balance
 * with a cash value: nothing can be topped up, transferred, gifted or withdrawn here. The employer receives anonymous totals of 10 people or more and never sees who joined or what was booked.
 */
export default function RedeemCode() {
  const { t, i18n } = useTranslation(); const lang = i18n.language; const q = useCorporateMe(); const join = useJoinCorporate(); const leave = useLeaveCorporate();
  const [code, setCode] = useState(""); const [confirmLeave, setConfirmLeave] = useState(false);
  const off = q.error instanceof ApiError && q.error.isFeatureDisabled;
  const err = join.error instanceof ApiError ? join.error : null;
  const submit = (e: FormEvent) => { e.preventDefault(); const c = cleanCorporateCode(code); if (c) join.mutate(c); };
  const valid = cleanCorporateCode(code) !== null;
  return (
    <div className="container max-w-2xl space-y-6 py-8" data-testid="corporate-page">
      <meta name="robots" content="noindex" />
      <PageHeader title={t("corporate.title")} hint={t("corporate.hint")} icon={<Briefcase />} />
      {q.isLoading ? <CardSkeleton rows={3} /> : off ? <UnavailableState featureKey={(q.error as ApiError).featureKey} awaiting={(q.error as ApiError).isAwaitingApproval} /> : !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data.member ? (
        <section className="kx-card space-y-4 p-5" aria-labelledby="corp-member" data-testid="corporate-member">
          <h2 id="corp-member" className="text-lg">{t("corporate.memberTitle", { sponsor: q.data.programme.sponsor })}</h2>
          {q.data.programme.endsAt && <p className="text-sm text-muted-foreground">{t("corporate.until", { date: formatDate(q.data.programme.endsAt, lang) })}</p>}
          <dl className="grid gap-3 sm:grid-cols-3" data-testid="corporate-allowance">
            <div><dt className="text-sm text-muted-foreground">{t("corporate.allowanceCap")}</dt><dd className="text-lg font-semibold tabular-nums">{formatMinor(q.data.allowance.capMinor, lang, q.data.programme.currency)}</dd></div>
            <div><dt className="text-sm text-muted-foreground">{t("corporate.allowanceUsed")}</dt><dd className="text-lg font-semibold tabular-nums">{formatMinor(q.data.allowance.usedMinor + q.data.allowance.heldMinor, lang, q.data.programme.currency)}</dd></div>
            <div><dt className="text-sm text-muted-foreground">{t("corporate.allowanceLeft")}</dt><dd className="text-lg font-semibold tabular-nums">{formatMinor(q.data.allowance.remainingMinor, lang, q.data.programme.currency)}</dd></div>
          </dl>
          <p className="text-sm text-muted-foreground" data-testid="corporate-how">{t("corporate.how")}</p>
          <p className="flex items-start gap-2 rounded-xl border bg-card p-3 text-sm" data-testid="corporate-privacy"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />{t("corporate.privacy")}</p>
          {!confirmLeave ? <Button variant="outline" className="min-h-11" onClick={() => setConfirmLeave(true)} data-testid="corporate-leave">{t("corporate.leave")}</Button> : (
            <div role="alertdialog" aria-labelledby="corp-leave-h" className="space-y-3 rounded-xl border border-warning/40 p-4" data-testid="corporate-leave-confirm">
              <p id="corp-leave-h" className="font-semibold">{t("corporate.leaveConfirm")}</p><p className="text-sm text-muted-foreground">{t("corporate.leaveHint")}</p>
              <div className="flex flex-wrap gap-2"><Button className="min-h-11" disabled={leave.isPending} onClick={() => leave.mutate(undefined, { onSuccess: () => setConfirmLeave(false) })} data-testid="corporate-leave-yes">{t("corporate.leaveYes")}</Button><Button variant="outline" className="min-h-11" onClick={() => setConfirmLeave(false)}>{t("corporate.cancel")}</Button></div>
            </div>)}
        </section>
      ) : (
        <section className="kx-card space-y-4 p-5" aria-labelledby="corp-join" data-testid="corporate-join">
          <h2 id="corp-join" className="text-lg">{t("corporate.joinTitle")}</h2>
          <form onSubmit={submit} className="space-y-3" noValidate>
            <label className="block text-sm font-medium" htmlFor="corp-code">{t("corporate.codeLabel")}</label>
            <input id="corp-code" dir="ltr" autoComplete="off" autoCapitalize="characters" spellCheck={false} inputMode="text" maxLength={24} value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={!!err} aria-describedby={err ? "corp-err" : "corp-help"}
              className="h-12 w-full rounded-xl border border-input bg-card px-3 font-mono text-lg tracking-widest" placeholder="XXXXX-XXXXX" data-testid="corporate-code" />
            <p id="corp-help" className="text-sm text-muted-foreground">{t("corporate.codeHelp")}</p>
            <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={!valid || join.isPending} data-testid="corporate-submit">{t("corporate.join")}</Button>
          </form>
          <div className="border-t pt-4"><p className="mb-2 text-sm text-muted-foreground">{t("corporate.orEmail")}</p><Button variant="outline" className="min-h-11" disabled={join.isPending} onClick={() => join.mutate(undefined)} data-testid="corporate-email">{t("corporate.useEmail")}</Button></div>
          {err && <p id="corp-err" role="alert" className="rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm" data-testid="corporate-error">{KNOWN.includes(err.code) ? t(`corporate.errors.${err.code}`) : t("corporate.errors.GENERIC")}</p>}
          <p className="text-xs text-muted-foreground" data-testid="corporate-terms" data-needs-human="true">{t("corporate.terms")}</p>
        </section>)}
    </div>
  );
}
