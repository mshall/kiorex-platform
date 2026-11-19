import { useTranslation } from "react-i18next";
import { Check, CircleDot, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MockNotice } from "@/components/states";
import { cn } from "@/lib/utils";

/** Linear progress for an order/booking; terminal failure states render as a single highlighted step. */
export function ProgressSteps({ steps, current, failed, i18nPrefix }: { steps: string[]; current: string; failed?: string | null; i18nPrefix: string }) {
  const { t } = useTranslation();
  const idx = steps.indexOf(current);
  return (
    <ol className="space-y-3" aria-label={t("orders.progress")} data-testid="order-progress">
      {steps.map((s, i) => {
        const done = !failed && idx >= 0 && i < idx; const here = !failed && i === idx;
        return (
          <li key={s} className={cn("flex items-center gap-3 text-sm", here ? "font-semibold" : done ? "text-foreground" : "text-muted-foreground")} aria-current={here ? "step" : undefined}>
            <span className={cn("flex h-7 w-7 items-center justify-center rounded-full border", done && "border-success bg-success-soft text-success", here && "border-pulse bg-pulse/15")}>{done ? <Check className="h-4 w-4" aria-hidden="true" /> : here ? <CircleDot className="h-4 w-4" aria-hidden="true" /> : i + 1}</span>
            {t(`${i18nPrefix}.${s}`)}
          </li>
        );
      })}
      {failed && <li className="flex items-center gap-3 text-sm font-semibold text-destructive" data-testid="order-failed"><span className="flex h-7 w-7 items-center justify-center rounded-full border border-destructive"><XCircle className="h-4 w-4" aria-hidden="true" /></span>{t(`${i18nPrefix}.${failed}`)}</li>}
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
    <div className="kx-card space-y-3 p-5" data-testid="pay-panel">
      <h3 className="text-lg">{t("orders.payTitle")}</h3>
      {sandbox && <MockNotice kind="payment" proven />}
      <p className="text-sm text-muted-foreground">{t("orders.payHint")}</p>
      <Button asChild size="lg"><a href={payment.checkoutUrl} target="_blank" rel="noopener noreferrer" onClick={onOpened} data-testid="pay-link">{label}</a></Button>
      <p className="text-xs text-muted-foreground" aria-live="polite">{t("orders.payWaiting")}</p>
    </div>
  );
}
