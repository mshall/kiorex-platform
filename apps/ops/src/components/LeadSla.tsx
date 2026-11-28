import { useTranslation } from "react-i18next";
import { StatusChip, type Tone } from "@/components/kit";
import { formatDateTime } from "@/lib/format";
import type { LeadSla } from "@/api/siteLeads";

/** Tone of the reminder state. Text always carries the state too (never colour alone). */
export const SLA_TONE: Record<string, Tone> = { OK: "neutral", REMIND: "warning", ESCALATED: "danger", OFF: "neutral" };

/** SLA chip and "untouched since" of a join request that is still New. Renders nothing for any other status (no clock). */
export function LeadSlaCell({ sla, testId, detail = false }: { sla: LeadSla | undefined; testId?: string; detail?: boolean }) {
  const { t, i18n } = useTranslation(); const lang = i18n.language;
  if (!sla || sla.state === "OFF") return <span className="text-xs text-muted-foreground">-</span>;
  return (
    <div className="min-w-36" data-testid={testId}>
      <StatusChip tone={SLA_TONE[sla.state] ?? "neutral"} data-testid={testId ? `${testId}-chip` : undefined}>{t(`siteLeads.sla.${sla.state}`)}</StatusChip>
      <span className="mt-0.5 block text-xs text-muted-foreground">{t("siteLeads.slaSince", { when: formatDateTime(sla.since, lang) })}</span>
      {detail && sla.remindAt && sla.escalateAt ? <span className="mt-0.5 block text-xs text-muted-foreground">{t("siteLeads.slaDue", { remind: formatDateTime(sla.remindAt, lang), escalate: formatDateTime(sla.escalateAt, lang) })}</span> : null}
    </div>
  );
}
