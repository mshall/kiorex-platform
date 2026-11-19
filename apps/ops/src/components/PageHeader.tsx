import type { ReactNode } from "react";
export function PageHeader({ title, hint, actions }: { title: string; hint?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl">{title}</h1>{hint && <p className="text-sm text-muted-foreground">{hint}</p>}</div>
      {actions}
    </div>
  );
}
export function StatTile({ label, value, tone }: { label: string; value: ReactNode; tone?: "warn" | "ok" }) {
  return (
    <div className="kx-card p-4"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className={`mt-1 text-2xl font-semibold kx-label-num ${tone === "warn" ? "text-warning" : tone === "ok" ? "text-success" : ""}`}>{value}</p></div>
  );
}
