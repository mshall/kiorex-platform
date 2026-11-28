import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { rawApi } from "@/api/client";
import { ApiError } from "@/api/errors";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Role dashboards (ADR-062): every card reads an EXISTING admin API with the person's own token, shows counts and links, and says honestly when it cannot (no access, error, nothing waiting). */
export const useDash = <T,>(key: string, path: string, enabled = true): UseQueryResult<T> =>
  useQuery({ queryKey: ["dash", key, path], queryFn: () => rawApi<T>("GET", path), retry: false, staleTime: 30_000, refetchOnWindowFocus: false, enabled });

/** Western digits in both languages. */
export const num = (v: number | null | undefined): string => (v == null || Number.isNaN(v) ? "-" : new Intl.NumberFormat("en-US").format(v));
export const arr = <T,>(d: unknown, key = "items"): T[] => (Array.isArray(d) ? (d as T[]) : Array.isArray((d as Record<string, unknown> | null | undefined)?.[key]) ? ((d as Record<string, unknown>)[key] as T[]) : []);
export const pending = (s: unknown): boolean => /PENDING|AWAITING|REQUESTED/i.test(String(s ?? ""));
export const when = (iso: string | null | undefined, lang: string): string => {
  if (!iso) return "-";
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return "-";
  return `${new Intl.DateTimeFormat(lang.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Cairo" }).format(d)} ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" }).format(d)}`;
};
/** Age as a short label with Western digits: "5 h" or "3 d". */
export const useAge = () => {
  const { t } = useTranslation();
  return (iso: string | null | undefined, now = Date.now()): string => {
    if (!iso) return "-"; const ms = now - new Date(iso).getTime(); if (!Number.isFinite(ms) || ms < 0) return "-";
    const h = Math.floor(ms / 3_600_000); return h < 48 ? t("roleHome.age.hours", { n: h }) : t("roleHome.age.days", { n: Math.floor(h / 24) });
  };
};
export const ageDays = (iso: string, now = Date.now()): number => Math.floor((now - new Date(iso).getTime()) / 86_400_000);

/** Loading, error and no-access states of a card, then the content. A refused call (403) says the card is not part of this role's work instead of showing an error. */
export function Card({ id, title, hint, to, linkLabel, q, children, className }: { id: string; title: string; hint?: string; to?: string; linkLabel?: string; q?: UseQueryResult<unknown>[]; children?: ReactNode; className?: string }) {
  const { t } = useTranslation();
  const bad = q?.find((x) => x.error);
  const loading = !bad && q?.some((x) => x.isLoading);
  const forbidden = bad?.error instanceof ApiError && bad.error.status === 403;
  return (
    <section className={cn("kx-card flex flex-col gap-3 p-4", className)} aria-labelledby={`dash-${id}-h`} data-testid={`card-${id}`}>
      <div className="flex items-start justify-between gap-2">
        <div><h2 id={`dash-${id}-h`} className="text-base font-semibold">{title}</h2>{hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}</div>
        {to && <Link to={to} className="shrink-0 text-sm font-medium text-primary underline-offset-2 hover:underline" data-testid={`card-${id}-link`}>{linkLabel ?? t("roleHome.open")}</Link>}
      </div>
      {loading ? <p className="text-sm text-muted-foreground" role="status">{t("roleHome.loading")}</p>
        : bad ? <div role="alert" className="text-sm"><p className="text-muted-foreground">{forbidden ? t("roleHome.forbidden") : t("roleHome.failed")}</p>{!forbidden && <Button size="sm" variant="outline" className="mt-2" onClick={() => q?.forEach((x) => void x.refetch())}>{t("states.retry")}</Button>}</div>
        : children}
    </section>
  );
}

export function Figures({ items }: { items: Array<{ label: string; value: ReactNode; tone?: "warn" | "ok" | "danger"; testid?: string }> }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((i) => (
        <div key={i.label} className="rounded-lg border bg-background/50 p-2.5">
          <dt className="text-xs text-muted-foreground">{i.label}</dt>
          <dd className={cn("kx-label-num mt-1 text-xl font-semibold leading-none", i.tone === "warn" && "text-warning", i.tone === "ok" && "text-success", i.tone === "danger" && "text-destructive")} data-testid={i.testid}>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Rows({ rows, empty, testid }: { rows: Array<{ key: string; primary: ReactNode; secondary?: ReactNode; end?: ReactNode }>; empty: string; testid?: string }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground" data-testid={testid ? `${testid}-empty` : undefined}>{empty}</p>;
  return (
    <ul className="divide-y text-sm" data-testid={testid}>
      {rows.map((r) => (
        <li key={r.key} className="flex items-center justify-between gap-3 py-1.5">
          <span className="min-w-0"><span className="block truncate font-medium">{r.primary}</span>{r.secondary && <span className="block truncate text-xs text-muted-foreground">{r.secondary}</span>}</span>
          {r.end && <span className="kx-label-num shrink-0 text-xs text-muted-foreground">{r.end}</span>}
        </li>
      ))}
    </ul>
  );
}

export function Shortcuts({ items }: { items: Array<{ to: string; label: string; external?: boolean }> }) {
  return (
    <ul className="flex flex-wrap gap-2" data-testid="dash-shortcuts">
      {items.map((i) => (
        <li key={i.to}>{i.external
          ? <a href={i.to} className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium hover:bg-accent" rel="noreferrer">{i.label}</a>
          : <Link to={i.to} className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium hover:bg-accent">{i.label}</Link>}</li>
      ))}
    </ul>
  );
}
