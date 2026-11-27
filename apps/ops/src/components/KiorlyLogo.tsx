import { cn } from "@/lib/utils";

/** Kiorly marks for the Kiorly admin edition. The Kiorex logo is never shown on a Kiorly surface. Files are the Kiorly set (`public/kiorly`, identical to the workspace brand kit); dark theme follows the app's `.dark` class. */
export function KiorlyLogo({ className, height = 40, arabic = false }: { className?: string; height?: number; arabic?: boolean }) {
  const base = arabic ? "/kiorly/kiorly-lockup-ar" : "/kiorly/kiorly-lockup";
  return (
    <span className={cn("inline-flex items-center", className)} dir="ltr" data-testid="kiorly-logo">
      <img src={`${base}.svg`} alt="Kiorly" height={height} style={{ height, width: "auto" }} className="dark:hidden" />
      <img src={`${base}-inverse.svg`} alt="" aria-hidden="true" height={height} style={{ height, width: "auto" }} className="hidden dark:block" />
    </span>
  );
}

export function KiorlyMark({ className, height = 28 }: { className?: string; height?: number }) {
  return (
    <span className={cn("inline-flex items-center", className)} dir="ltr" data-testid="kiorly-mark">
      <img src="/kiorly/kiorly-mark.svg" alt="Kiorly" height={height} style={{ height, width: "auto" }} className="dark:hidden" />
      <img src="/kiorly/kiorly-mark-inverse.svg" alt="" aria-hidden="true" height={height} style={{ height, width: "auto" }} className="hidden dark:block" />
    </span>
  );
}
