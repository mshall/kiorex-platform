import { cn } from "@/lib/utils";
import { fmtN } from "@/lib/growthFormat";

/** Accessible horizontal bars: the number is always printed, the bar is decoration. */
export function BarList({ rows, tone = "primary", testid }: { rows: Array<{ label: string; value: number; hint?: string; id?: string }>; tone?: "primary" | "ocean" | "pulse"; testid?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const color = tone === "ocean" ? "bg-ocean" : tone === "pulse" ? "bg-pulse" : "bg-primary";
  return (
    <ul className="space-y-2" data-testid={testid}>
      {rows.map((r) => (
        <li key={r.id ?? r.label} className="text-sm">
          <div className="flex items-baseline justify-between gap-3"><span className="min-w-0 truncate" title={r.hint}>{r.label}</span><span className="kx-label-num font-semibold" data-testid={testid ? `${testid}-${r.id ?? r.label}` : undefined}>{fmtN(r.value)}</span></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className={cn("h-full rounded-full", color)} style={{ width: `${Math.round((r.value / max) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}
