import { cn } from "@/lib/utils";

const PATH = "M0 12 H110 l4 -6 l4 12 l5 -16 l5 14 l3 -4 H240";

/** Subtle brand motif: a static ECG divider. Use sparingly — section breaks, not decoration. */
export function PulseDivider({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 24" preserveAspectRatio="none" aria-hidden="true" className={cn("h-4 w-full text-border", className)} focusable="false">
      <path d={PATH} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M100 12 H110 l4 -6 l4 12 l5 -16 l5 14 l3 -4 H140" fill="none" className="stroke-pulse" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Loader: the pulse line draws itself. Honours prefers-reduced-motion (global CSS). */
export function PulseLoader({ label, className }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("flex flex-col items-center gap-3 py-10 text-muted-foreground", className)}>
      <svg viewBox="0 0 240 24" className="h-8 w-40" aria-hidden="true">
        <path d={PATH} fill="none" className="stroke-border" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d={PATH} fill="none" className="stroke-pulse animate-pulseline" strokeWidth="2.5" strokeDasharray="200" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label ? <span className="text-sm">{label}</span> : <span className="sr-only">Loading</span>}
    </div>
  );
}
