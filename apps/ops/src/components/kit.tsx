/* Shared layout primitives (Q11): PageHeader, StatCard, StatusChip, FormField, Stepper, StateArt. Keep screens thin: compose these. */
import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, hint, icon, actions, badge, className, id }: { title: ReactNode; hint?: ReactNode; icon?: ReactNode; actions?: ReactNode; badge?: ReactNode; className?: string; id?: string }) {
  return (
    <header className={cn("mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary [&_svg]:h-5 [&_svg]:w-5" aria-hidden="true">{icon}</span>}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h1 id={id} className="text-2xl md:text-3xl">{title}</h1>{badge}</div>
          {hint && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";
const TONE: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-info-soft text-info",
  brand: "bg-accent text-accent-foreground",
};
const DOT: Record<Tone, string> = { neutral: "bg-muted-foreground", success: "bg-success", warning: "bg-warning", danger: "bg-destructive", info: "bg-info", brand: "bg-primary" };

/** Consistent semantic status pill. Coral is never used for errors; danger is red. Always pairs colour with a dot + text. */
export function StatusChip({ tone = "neutral", children, className, dot = true, ...rest }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span {...rest} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", TONE[tone], className)}>
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", DOT[tone])} aria-hidden="true" />}
      {children}
    </span>
  );
}

export function StatCard({ label, value, hint, tone, icon, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: "ok" | "warn" | "danger"; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn("kx-card p-4", className)}>
      <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium text-muted-foreground">{label}</p>{icon && <span className="text-muted-foreground [&_svg]:h-4 [&_svg]:w-4" aria-hidden="true">{icon}</span>}</div>
      <p className={cn("kx-label-num mt-1.5 text-2xl font-semibold leading-none", tone === "warn" && "text-warning", tone === "ok" && "text-success", tone === "danger" && "text-destructive")}>{value}</p>
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Label + control + hint + error wired with ids (aria-describedby / aria-invalid). Pass a single form control as the child. */
export function FormField({ label, hint, error, required, children, className }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; required?: boolean; children: ReactElement; className?: string }) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
  const control = isValidElement(children) ? cloneElement(children as ReactElement<Record<string, unknown>>, { id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined, "aria-required": required || undefined }) : children;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium">{label}{required && <span className="ms-1 text-destructive" aria-hidden="true">*</span>}</label>
      {control}
      {hint && !error && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p id={`${id}-err`} role="alert" className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}

/** Horizontal progress for multi-step flows (booking). `current` is 0-based. */
export function Stepper({ steps, current, label, className }: { steps: string[]; current: number; label?: string; className?: string }) {
  return (
    <nav aria-label={label} className={className}>
      <ol className="flex items-center gap-2">
        {steps.map((s, i) => {
          const done = i < current, active = i === current;
          return (
            <li key={s} className={cn("flex min-w-0 items-center gap-2", i < steps.length - 1 && "flex-1")} aria-current={active ? "step" : undefined}>
              <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors", done && "border-primary bg-primary text-primary-foreground", active && "border-primary text-primary ring-4 ring-primary/15", !done && !active && "text-muted-foreground")}>
                {done ? <Check className="h-4 w-4" aria-hidden="true" /> : i + 1}
              </span>
              <span className={cn("truncate text-sm", active ? "font-semibold" : "text-muted-foreground")}>{s}</span>
              {i < steps.length - 1 && <span className={cn("h-px flex-1 min-w-4 transition-colors", done ? "bg-primary" : "bg-border")} aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Brand illustration for empty / error / offline / search states: built from the chevron + pulse motif (no stock art). */
export function StateArt({ kind = "empty", className }: { kind?: "empty" | "error" | "offline" | "search" | "success"; className?: string }) {
  const pulse = kind === "error" ? "M10 60 H70 L78 52 L86 76 L94 40 L98 60 H108" : kind === "offline" ? "M10 60 H64 M76 60 H88 M100 60 H110" : kind === "success" ? "M10 60 H52 L62 70 L84 36 L110 60" : "M10 60 H70 L78 52 L86 76 L94 40 L102 66 L108 60 H110";
  return (
    <svg viewBox="0 0 120 120" className={cn("h-24 w-24", className)} aria-hidden="true" focusable="false">
      <circle cx="60" cy="60" r="54" className="fill-accent" />
      <polyline points="40,28 58,60 40,92" fill="none" strokeWidth="6" strokeLinejoin="miter" className="stroke-primary" opacity={kind === "offline" ? 0.5 : 1} />
      <polyline points="80,28 62,60 80,92" fill="none" strokeWidth="6" strokeLinejoin="miter" className="stroke-ocean" opacity={kind === "offline" ? 0.5 : 1} />
      <path d={pulse} fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={cn(kind === "error" ? "stroke-destructive" : kind === "success" ? "stroke-success" : "stroke-pulse", "kx-pulse-draw")} style={{ ["--kx-pulse-len" as string]: 160 }} />
      {kind === "search" && <circle cx="92" cy="92" r="12" fill="none" strokeWidth="4" className="stroke-primary" />}
    </svg>
  );
}
