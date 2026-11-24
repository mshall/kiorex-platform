import { useTranslation } from "react-i18next";
import { BadgePercent } from "lucide-react";
import { formatMoney } from "@/lib/format";
import type { SponsoredQuote } from "@/api/sponsored";

/**
 * GRW-P2-S: the sponsored discount line of the checkout. Always "sponsored by <clinic> until <date>", never a Kiorex discount. The meaning is carried by text and an icon (not by colour alone);
 * it is a labelled group so a screen reader hears the label, the amount and the note together; the amount is a left-to-right island inside right-to-left Arabic text.
 */
export function SponsoredDiscountLine({ quote, lang }: { quote: SponsoredQuote; lang: string }) {
  const { t } = useTranslation();
  const sponsor = (lang.startsWith("ar") ? quote.sponsor.ar : quote.sponsor.en) || t("sponsored.title");
  const date = quote.endsAt.slice(0, 10);
  const label = (lang.startsWith("ar") ? quote.label.ar : quote.label.en) || t("sponsored.line", { sponsor, date });
  const amount = formatMoney(quote.amountMinor / 100, lang);
  return (
    <div className="space-y-1 rounded-xl border border-success/40 bg-success-soft p-3" role="group" aria-label={t("sponsored.title")} data-testid="sponsored-line">
      <p className="flex items-start gap-2 text-sm font-semibold text-foreground">
        <BadgePercent className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
        <span className="min-w-0 flex-1 break-words" data-testid="sponsored-label">{label}</span>
        <span className="kx-label-num shrink-0" dir="ltr" aria-label={t("sponsored.amount", { amount })} data-testid="sponsored-amount">−{amount}</span>
      </p>
      <p className="text-xs text-muted-foreground" data-testid="sponsored-note">{t("sponsored.note", { sponsor })}</p>
    </div>
  );
}
