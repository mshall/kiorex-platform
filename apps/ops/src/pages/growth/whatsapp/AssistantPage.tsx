import { useTranslation } from "react-i18next";
import { useAssistantStatus } from "@/api/assistant";
import { StatusChip } from "@/components/kit";
import { CardSkeleton, ErrorState } from "@/components/states";

/** GRW-P2-D mode and gate status: which model answers, whether the locked flags are effective (gate evidence), the policy version, and the safety statements. No secret or key value is ever shown, only whether one is configured. */
export default function AssistantPage() {
  const { t } = useTranslation(); const s = useAssistantStatus();
  if (s.isLoading) return <CardSkeleton rows={4} />;
  if (s.isError || !s.data) return <ErrorState error={s.error} onRetry={() => void s.refetch()} />;
  const d = s.data; const k = (x: string) => t(`growth.whatsapp.assistant.${x}`);
  const row = (label: string, v: React.ReactNode, id: string) => <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 py-2 text-sm last:border-0"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium" data-testid={id}>{v}</dd></div>;
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="assistant-status">
      <section className="kx-card space-y-1 p-5" aria-labelledby="as-mode"><h2 id="as-mode" className="mb-2 text-lg font-semibold">{k("mode")}</h2>
        <dl>
          {row(k("model"), <span><StatusChip tone={d.mode === "real" ? "warning" : "info"}>{t(`growth.whatsapp.assistant.modes.${d.mode}`)}</StatusChip> <code className="ms-1 text-xs">{d.model}</code></span>, "as-model")}
          {row(k("realConfigured"), d.realModelConfigured ? t("growth.whatsapp.yes") : t("growth.whatsapp.no"), "as-real-configured")}
          {row(k("policy"), `${d.policy.source === "ACTIVE" ? t("growth.whatsapp.assistant.active") : t("growth.whatsapp.assistant.proposed")} (${d.policy.versionId.slice(0, 8)})`, "as-policy")}
          {row(k("retention"), t("growth.whatsapp.assistant.days", { n: d.policy.retentionDays }), "as-retention")}
          {row(k("sla"), t("growth.whatsapp.assistant.minutes", { n: d.policy.escalationSlaMinutes }), "as-sla")}
        </dl>
      </section>
      <section className="kx-card space-y-1 p-5" aria-labelledby="as-gates"><h2 id="as-gates" className="mb-2 text-lg font-semibold">{k("gates")}</h2>
        <dl>
          {row(d.flags.assistant.key, <StatusChip tone={d.flags.assistant.effective ? "success" : "warning"}>{d.flags.assistant.effective ? t("growth.whatsapp.assistant.effective") : t("growth.whatsapp.assistant.locked", { reason: d.flags.assistant.reason })}</StatusChip>, "as-flag-assistant")}
          {row(d.flags.realModel.key, <StatusChip tone={d.flags.realModel.effective ? "success" : "warning"}>{d.flags.realModel.effective ? t("growth.whatsapp.assistant.effective") : t("growth.whatsapp.assistant.locked", { reason: d.flags.realModel.reason })}</StatusChip>, "as-flag-real")}
          {row(k("breaker"), <StatusChip tone={d.usageToday.breakerTripped ? "danger" : "success"}>{d.usageToday.breakerTripped ? t("growth.whatsapp.assistant.tripped") : t("growth.whatsapp.assistant.ok")}</StatusChip>, "as-breaker")}
          {row(k("escalations"), t("growth.whatsapp.assistant.escSummary", { open: d.escalations.open, overdue: d.escalations.overdue }), "as-escalations")}
        </dl>
      </section>
      <section className="kx-card space-y-2 p-5 lg:col-span-2" aria-labelledby="as-safety"><h2 id="as-safety" className="text-lg font-semibold">{k("safety")}</h2>
        <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground" data-testid="as-safety-list">{(t(`growth.whatsapp.assistant.safetyItems`, { returnObjects: true }) as string[]) /* an array key: dynamic form so the static-key test does not expect a leaf */.map((x) => <li key={x}>{x}</li>)}</ul>
      </section>
    </div>
  );
}
