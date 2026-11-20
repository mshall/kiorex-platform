import { KiorexLogo } from "@/brand/components/web/KiorexLogo";
import { cn } from "@/lib/utils";

/** Founder artwork via the vendored brand kit (src/brand). Colour in light mode, inverse in dark mode (swapped by the `.dark` class, no JS). */
function Themed({ variant, className, title }: { variant: "lockup" | "mark" | "wordmark"; className?: string; title?: string }) {
  return (
    <>
      <KiorexLogo variant={variant} tone="color" title={title ?? ""} className={cn("h-10 w-auto dark:hidden", className)} />
      <KiorexLogo variant={variant} tone="inverse" title={title ?? ""} className={cn("hidden h-10 w-auto dark:block", className)} />
    </>
  );
}

export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return <Themed variant="mark" className={cn("h-8", className)} title={title} />;
}

/** Wordmark is always Latin "KIOREX" (outlined Jost, final X in Ocean) even in an Arabic UI. */
export function Wordmark({ className }: { className?: string }) {
  return <Themed variant="wordmark" className={cn("h-4", className)} />;
}

export function Logo({ className, markClassName, wordmark = true }: { className?: string; markClassName?: string; wordmark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center", className)} dir="ltr">
      {wordmark ? <Themed variant="lockup" className={markClassName ?? "h-9 sm:h-10"} /> : <LogoMark className={markClassName} />}
      <span className="sr-only">Kiorex</span>
    </span>
  );
}
