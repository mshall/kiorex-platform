import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAutomationStatus, useJourneys, type JourneyStatus } from "@/api/automation";
import { useGrowthAccess } from "@/api/growth";
import { GrowthPage, Section, selectCls } from "@/components/growth/GrowthPage";
import { StatusBanner, StatusLabel, primaryBtnCls } from "./shared";

const STATUSES: JourneyStatus[] = ["DRAFT", "PENDING_APPROVAL", "PUBLISHED", "RETIRED"];

/** The journeys, newest first. Cards at every width (no horizontal scroll at 320 px). The New button is for a super admin only. */
export default function JourneyListPage() {
  const { t } = useTranslation(); const [status, setStatus] = useState(""); const list = useJourneys({ status: status || undefined }); const st = useAutomationStatus();
  const access = useGrowthAccess(); const can = !!(access.data?.capabilities as Record<string, boolean> | undefined)?.manageCampaigns;
  const rows = list.data ?? [];
  return (
    <GrowthPage section="automation" actions={can ? <Link to="/growth/automation?new=1" className={primaryBtnCls} data-testid="auto-new">{t("growth.automation.new")}</Link> : null}
      toolbar={<label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{t("growth.automation.list.filter")}</span>
        <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="auto-status-filter"><option value="">{t("growth.automation.list.all")}</option>{STATUSES.map((s) => <option key={s} value={s}>{t(`growth.automation.status.${s}`)}</option>)}</select></label>}>
      <StatusBanner status={st.data} />
      <Section title={t("growth.automation.list.title")} id="auto-list">
        {list.isLoading ? <p className="text-sm text-muted-foreground">…</p> : rows.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="auto-empty">{t("growth.automation.list.empty")}</p> : (
          <ul className="space-y-3" data-testid="auto-journeys">
            {rows.map((j) => {
              const trig = j.graph.nodes.find((n) => n.type === "TRIGGER")?.event ?? "";
              return (
                <li key={j.id} className="rounded-xl border bg-card p-3" data-testid={`auto-row-${j.key}-${j.version}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0"><Link to={`/growth/automation?id=${j.id}`} className="font-semibold underline-offset-4 hover:underline" data-testid={`auto-open-${j.key}-${j.version}`}>{j.name || j.key}</Link><p className="break-all text-xs text-muted-foreground" dir="ltr">{j.key}</p></div>
                    <StatusLabel status={j.status} killed={!!j.killedAt} />
                  </div>
                  <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                    <div><dt className="text-muted-foreground">{t("growth.automation.list.trigger")}</dt><dd>{t(`growth.automation.trigger.${trig}`, { defaultValue: trig })}</dd></div>
                    <div><dt className="text-muted-foreground">{t("growth.automation.list.version")}</dt><dd dir="ltr">v{j.version}</dd></div>
                    <div><dt className="text-muted-foreground">{t("growth.automation.list.author")}</dt><dd className="break-all" dir="ltr">{j.createdBy}</dd></div>
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </GrowthPage>
  );
}
