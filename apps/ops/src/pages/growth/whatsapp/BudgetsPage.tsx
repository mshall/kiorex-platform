import { useTranslation } from "react-i18next";
import { useAssistantMetrics, useAssistantStatus, useBudgets, useResetBreaker } from "@/api/assistant";
import { useGrowthAccess } from "@/api/growth";
import { StatusChip } from "@/components/kit";
import { CardSkeleton, ErrorState } from "@/components/states";

const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 1000) / 10}%`);
const egp = (m: number | null) => (m === null ? "-" : `${Math.round(m) / 100}`);

/** GRW-P2-D budgets, the daily cost breaker and the metrics. Metrics hide below k = 10 conversations (no small-number leaks); cost is 0 in mock mode but the token budgets are exercised with synthetic counts. */
export default function BudgetsPage() {
  const { t } = useTranslation(); const b = useBudgets(); const s = useAssistantStatus(); const m = useAssistantMetrics(); const reset = useResetBreaker(); const access = useGrowthAccess(); const isSuper = !!access.data?.roles.includes("super_admin");
  if (b.isLoading || s.isLoading) return <CardSkeleton rows={4} />;
  if (b.isError || !b.data || s.isError || !s.data) return <ErrorState error={b.error ?? s.error} onRetry={() => { void b.refetch(); void s.refetch(); }} />;
  const u = s.data.usageToday; const cap = b.data.budgets.costPerMarketDayMinor; const k = (x: string) => t(`growth.whatsapp.budgets.${x}`);
  return (
    <div className="space-y-4" data-testid="assistant-budgets">
      <section className="kx-card space-y-3 p-5" aria-labelledby="bd-today"><h2 id="bd-today" className="text-lg font-semibold">{k("today")}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={k("tokens")} value={String(u.tokens)} id="bd-tokens" /><Stat label={k("conversations")} value={String(u.conversations)} id="bd-conv" />
          <Stat label={k("cost")} value={`${egp(u.costMinor)} / ${egp(cap)}`} id="bd-cost" /><div className="rounded-xl border border-border p-3"><div className="text-xs text-muted-foreground">{k("breaker")}</div><StatusChip tone={u.breakerTripped ? "danger" : "success"} data-testid="bd-breaker">{u.breakerTripped ? k("tripped") : k("ok")}</StatusChip></div>
        </div>
        {u.breakerTripped && <div className="flex flex-wrap items-center gap-3 rounded-xl bg-danger-soft p-3 text-sm text-danger" role="alert"><span>{k("trippedNote")}</span>{isSuper && <button type="button" className="h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground" disabled={reset.isPending} onClick={() => reset.mutate()} data-testid="bd-reset">{k("reset")}</button>}</div>}
      </section>
      <section className="kx-card space-y-2 p-5" aria-labelledby="bd-limits"><h2 id="bd-limits" className="text-lg font-semibold">{k("limits")}</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3" data-testid="bd-limits">{[["tokensPerTurn", b.data.budgets.tokensPerTurn], ["tokensPerConversation", b.data.budgets.tokensPerConversation], ["turnsPerConversation", b.data.budgets.turnsPerConversation], ["tokensPerSubjectDay", b.data.budgets.tokensPerSubjectDay], ["messagesPerNumberPerHour", b.data.rateLimits.messagesPerNumberPerHour], ["globalConcurrency", b.data.rateLimits.globalConcurrency]].map(([n, v]) => <div key={n as string} className="rounded-xl border border-border p-3"><dt className="text-xs text-muted-foreground">{t(`growth.whatsapp.budgets.limit.${n}`)}</dt><dd className="font-semibold tabular-nums">{v as number}</dd></div>)}</dl>
      </section>
      <section className="kx-card space-y-2 p-5" aria-labelledby="bd-metrics"><h2 id="bd-metrics" className="text-lg font-semibold">{k("metrics")}</h2>
        {m.isLoading ? <CardSkeleton rows={2} /> : m.isError || !m.data ? <ErrorState error={m.error} onRetry={() => void m.refetch()} /> : m.data.masked ? <p className="text-sm text-muted-foreground" data-testid="bd-masked">{t("growth.whatsapp.budgets.masked", { k: m.data.k })}</p> : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="bd-metric-grid"><Stat label={k("containment")} value={pct(m.data.containmentRate)} id="bd-containment" /><Stat label={k("handoff")} value={pct(m.data.handoffRate)} id="bd-handoff" /><Stat label={k("completion")} value={pct(m.data.bookingCompletionRate)} id="bd-completion" /><Stat label={k("costPerBooking")} value={egp(m.data.costPerBookingMinor)} id="bd-cpb" /><Stat label={k("p95")} value={m.data.p95LatencyMs === null ? "-" : `${m.data.p95LatencyMs} ms`} id="bd-p95" /></div>)}
      </section>
      <section className="kx-card p-5" aria-labelledby="bd-days"><h2 id="bd-days" className="mb-2 text-lg font-semibold">{k("history")}</h2>
        <div className="relative overflow-x-auto"><table className="w-full text-sm" data-testid="bd-days"><caption className="sr-only">{k("history")}</caption><thead><tr className="text-start text-muted-foreground"><th className="py-1 text-start">{k("day")}</th><th className="text-start">{k("tokens")}</th><th className="text-start">{k("conversations")}</th><th className="text-start">{k("cost")}</th><th className="text-start">{k("breaker")}</th></tr></thead>
          <tbody>{b.data.days.map((d) => <tr key={d.day} className="border-t border-border/60"><td className="py-1">{d.day}</td><td className="tabular-nums">{d.tokens}</td><td className="tabular-nums">{d.conversations}</td><td className="tabular-nums">{egp(d.costMinor)}</td><td>{d.breakerTripped ? k("tripped") : k("ok")}</td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}
function Stat({ label, value, id }: { label: string; value: string; id: string }) { return <div className="rounded-xl border border-border p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="text-xl font-semibold tabular-nums" data-testid={id}>{value}</div></div>; }
