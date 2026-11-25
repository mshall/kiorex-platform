import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/errors";
import { cleanPartnerCode, useRedeemPartnerCode } from "@/api/loyalty";
import { Button } from "@/components/ui/button";
import { formatMinor } from "@/lib/format";

/** "Have a partner code?" (GRW-P4-D): one use per offer; the voucher goes to the normal vouchers list. The code is never logged or echoed back. The offer terms are counsel's text (placeholder until supplied). */
export default function PartnerCode() {
  const { t, i18n } = useTranslation(); const lang = i18n.language; const redeem = useRedeemPartnerCode(); const [code, setCode] = useState("");
  const err = redeem.error instanceof ApiError ? redeem.error : null; const valid = cleanPartnerCode(code) !== null;
  const submit = (e: FormEvent) => { e.preventDefault(); const c = cleanPartnerCode(code); if (c) redeem.mutate(c, { onSuccess: () => setCode("") }); };
  const done = redeem.data;
  return (
    <section className="kx-card space-y-3 p-5" aria-labelledby="loy-partner" data-testid="loyalty-partner">
      <h2 id="loy-partner" className="text-lg">{t("loyalty.partnerTitle")}</h2>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <label className="block text-sm font-medium" htmlFor="loy-partner-code">{t("loyalty.partnerLabel")}</label>
        <input id="loy-partner-code" dir="ltr" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={24} value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={!!err} aria-describedby={err ? "loy-partner-err" : "loy-partner-help"}
          className="h-12 w-full rounded-xl border border-input bg-card px-3 font-mono text-lg tracking-widest" placeholder="XXXXX-XXXXX" data-testid="loyalty-partner-code" />
        <p id="loy-partner-help" className="text-sm text-muted-foreground">{t("loyalty.partnerHelp")}</p>
        <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={!valid || redeem.isPending} data-testid="loyalty-partner-submit">{t("loyalty.partnerButton")}</Button>
      </form>
      {err && <p id="loy-partner-err" role="alert" className="rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm" data-testid="loyalty-partner-error">{t(`loyalty.errors.${err.code}`, { defaultValue: t("loyalty.errors.GENERIC") })}</p>}
      {done && <p role="status" className="rounded-xl border border-success/40 bg-success/5 p-3 text-sm" data-testid="loyalty-partner-done">{t("loyalty.partnerDone", { value: formatMinor(done.amountMinor, lang, done.currency), partner: lang.startsWith("ar") ? done.partner.ar : done.partner.en })}</p>}
      <p className="text-xs text-muted-foreground" data-testid="loyalty-partner-terms" data-needs-human="true">{t("loyalty.partnerTerms")}</p>
    </section>
  );
}
