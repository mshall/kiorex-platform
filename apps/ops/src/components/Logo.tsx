import { cn } from "@/lib/utils";

/** The Kiorex X mark: indigo + ocean strokes crossing, coral pulse through the centre (_brand/kiorex-mark.svg). */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 120 80" className={cn("h-8 w-auto", className)} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <line x1="28" y1="6" x2="72" y2="74" strokeWidth="7" className="stroke-primary" />
      <line x1="92" y1="6" x2="48" y2="74" strokeWidth="7" className="stroke-ocean" />
      <polyline points="2,40 52,40 55,35 58,46 62,28 66,44 69,40 118,40" fill="none" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" className="stroke-pulse" />
    </svg>
  );
}

/** Wordmark is always Latin "KIOREX" (letter-spaced, final X in Ocean) even in Arabic UI. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span dir="ltr" lang="en" className={cn("font-['Jost'] text-xl font-semibold tracking-[0.28em] text-primary", className)} aria-label="Kiorex">
      <span aria-hidden="true">KIORE<span className="text-ocean">X</span></span>
    </span>
  );
}

export function Logo({ className, markClassName, wordmark = true }: { className?: string; markClassName?: string; wordmark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <LogoMark className={markClassName} />
      {wordmark ? <Wordmark /> : <span className="sr-only">Kiorex</span>}
    </span>
  );
}
