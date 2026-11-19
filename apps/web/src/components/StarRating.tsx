import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@/lib/format";

export function Rating({ avg, count }: { avg: number | null; count: number }) {
  const { t, i18n } = useTranslation();
  if (avg == null || count === 0) return <span className="text-sm text-muted-foreground">{t("doctor.noReviews")}</span>;
  return (
    <span className="inline-flex items-center gap-1 text-sm" aria-label={t("doctor.ratingLabel", { avg: formatNumber(avg, i18n.language), count })}>
      <Star className="h-4 w-4 fill-pulse text-pulse" aria-hidden="true" />
      <b className="kx-label-num">{formatNumber(avg, i18n.language)}</b>
      <span className="text-muted-foreground">({formatNumber(count, i18n.language, 0)})</span>
    </span>
  );
}

export function StarInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1" dir="ltr">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n}`} onClick={() => onChange(n)} className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-accent">
          <Star className={n <= value ? "h-7 w-7 fill-pulse text-pulse" : "h-7 w-7 text-muted-foreground"} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
