import { useTranslation } from "react-i18next";
import { Star } from "lucide-react";
import { formatNumber } from "@/lib/format";
import type { Review } from "@/api/types";

/** Average + 5..1 distribution bars computed from the loaded verified-visit reviews (no invented numbers). */
export function ReviewSummary({ avg, count, items }: { avg: number | null; count: number; items: Review[] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const dist = [5, 4, 3, 2, 1].map((n) => ({ n, c: items.filter((r) => Math.round(r.rating) === n).length }));
  const max = Math.max(1, ...dist.map((d) => d.c));
  if (avg == null || count === 0) return null;
  return (
    <div className="kx-card grid gap-6 p-5 sm:grid-cols-[auto_1fr] sm:items-center" data-testid="review-summary">
      <div className="text-center sm:px-4">
        <p className="kx-label-num text-5xl font-semibold leading-none">{formatNumber(avg, lang)}</p>
        <div className="mt-2 flex justify-center gap-0.5" aria-hidden="true">{[1, 2, 3, 4, 5].map((n) => <Star key={n} className={n <= Math.round(avg) ? "h-4 w-4 fill-pulse text-pulse" : "h-4 w-4 text-border"} />)}</div>
        <p className="mt-1 text-xs text-muted-foreground">{t("doctor.reviewsCount", { count })}</p>
      </div>
      <div className="space-y-1.5" role="group" aria-label={t("doctor.distribution")} dir="ltr">
        {dist.map((d) => (
          <div key={d.n} className="flex items-center gap-3 text-xs">
            <span className="kx-label-num w-3 text-end font-medium">{d.n}</span><Star className="h-3 w-3 fill-pulse text-pulse" aria-hidden="true" />
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-gradient-to-r from-primary to-ocean transition-[width] duration-500" style={{ width: `${(d.c / max) * 100}%` }} /></div>
            <span className="kx-label-num w-6 text-muted-foreground">{d.c}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
