import { useTranslation } from "react-i18next";
import { Check, CircleDot, CreditCard, XCircle } from "lucide-react";
import { IconTile } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { MockNotice } from "@/components/states";
import { cn } from "@/lib/utils";

/** Order / booking tracker (Q11 P3): horizontal on tablets and up, vertical on phones. The current step pulses, finished steps are checked,
 *  a terminal failure (rejected / cancelled / partial review) replaces the remaining path with one red step. */
export function ProgressSteps({ steps, current, failed, i18nPrefix }: { steps: string[]; current: string; failed?: string | null; i18nPrefix: string }) {
  const { t } = useTranslation();
  const idx = steps.indexOf(current);
  const all = failed ? [...steps, failed] : steps;
  return (
    <ol className="flex flex-col sm:flex-row" aria-label={t("orders.progress")} data-testid="order-progress">
      {all.map((s, i) => {
        const isFail = !!failed && i === all.length - 1;
        const finished = !failed && idx === steps.length - 1; // terminal success: every step is checked
        const done = !failed && idx >= 0 && (i < idx || finished); const here = !failed && !finished && i === idx;
        const last = i === all.length - 1;
        return (
          <li key={s} className={cn("relative flex gap-3 sm:flex-1 sm:flex-col sm:items-center sm:gap-2 sm:text-center", !last && "pb-6 sm:pb-0")} aria-current={here ? "step" : undefined} data-testid={isFail ? "order-failed" : undefined}>
            {!last && <span className={cn("absolute inset-s-[17px] top-9 h-[calc(100%-2.25rem)] w-0.5 sm:inset-s-[calc(50%+22px)] sm:top-[17px] sm:h-0.5 sm:w-[calc(100%-44px)]", done ? "bg-success" : "bg-border")} aria-hidden="true" />}
            <span className={cn("relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 bg-card text-sm font-semibold kx-label-num", done && "border-success bg-success text-white", here && "border-pulse text-foreground shadow-[0_0_0_5px_hsl(var(--pulse)/0.18)]", isFail && "border-destructive bg-destructive text-white", !done && !here && !isFail && "border-border text-muted-foreground", failed && !isFail && "opacity-60")}>
              {done ? <Check className="h-4 w-4" aria-hidden="true" /> : isFail ? <XCircle className="h-4 w-4" aria-hidden="true" /> : here ? <CircleDot className="h-4 w-4 text-pulse" aria-hidden="true" /> : i + 1}
            </span>
            <span className={cn("pt-1.5 text-sm sm:pt-0", here || isFail ? "font-semibold" : done ? "text-foreground" : "text-muted-foreground", isFail && "text-destructive")}>{t(`${i18nPrefix}.${s}`)}</span>
          </li>
        );
      })}
    </ol>
  );
}

export type OrderPayment = { paymentId: string; status: string; checkoutUrl: string | null };
export const asPayment = (p: unknown): OrderPayment | null => (p && typeof p === "object" && "paymentId" in p ? (p as OrderPayment) : null);

/** Kiorex Pay hosted checkout. In local dev this is the API's sandbox page (checkoutUrl contains /fake-checkout/): shown honestly as no real money. */
export function PayPanel({ payment, label, onOpened }: { payment: OrderPayment | null; label: string; onOpened?: () => void }) {
  const { t } = useTranslation();
  if (!payment?.checkoutUrl) return null;
  const sandbox = payment.checkoutUrl.includes("fake-checkout");
  return (
    <section className="kx-card space-y-3 border-primary/30 bg-accent/40 p-5" data-testid="pay-panel" aria-labelledby="pay-h">
      <div className="flex items-center gap-3"><IconTile tone="brand"><CreditCard /></IconTile><div><h3 id="pay-h" className="text-lg">{t("orders.payTitle")}</h3><p className="text-sm text-muted-foreground">{t("orders.payHint")}</p></div></div>
      {sandbox && <MockNotice kind="payment" proven />}
      <Button asChild size="lg" className="w-full sm:w-auto"><a href={payment.checkoutUrl} target="_blank" rel="noopener noreferrer" onClick={onOpened} data-testid="pay-link">{label}</a></Button>
      <p className="text-xs text-muted-foreground" aria-live="polite">{t("orders.payWaiting")}</p>
    </section>
  );
}
