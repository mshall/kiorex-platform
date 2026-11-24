import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useTemplates } from "@/api/growth";
import { StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { GrowthPage, Section, selectCls } from "@/components/growth/GrowthPage";

/** Communication templates: the shipped notification templates with their consent class. Read-only: copy and Meta approval are NEEDS_HUMAN. */
export default function GrowthTemplatesPage() {
  const { t, i18n } = useTranslation(); const q = useTemplates(); const [purpose, setPurpose] = useState(""); const ar = i18n.language.startsWith("ar");
  const rows = (q.data ?? []).filter((r) => !purpose || r.purpose === purpose);
  return (
    <GrowthPage section="templates" actions={<Link className="text-sm font-semibold text-primary hover:underline" to="/messaging">{t("growth.templates.openMessaging")}</Link>}
      toolbar={<label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{t("growth.templates.purpose")}</span><select className={selectCls} value={purpose} onChange={(e) => setPurpose(e.target.value)} data-testid="template-filter"><option value="">{t("growth.common.all")}</option>{["TRANSACTIONAL", "REMINDER", "MARKETING"].map((p) => <option key={p} value={p}>{t(`growth.templates.purposes.${p}`)}</option>)}</select></label>}>
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <Section title={t("growth.templates.list", { count: rows.length })} id="tp-list" hint={t("growth.templates.hint")}>
          <DataTable caption={t("growth.templates.list", { count: rows.length })} rows={rows} rowKey={(r) => r.kind} empty={t("growth.templates.empty")} columns={[
            { key: "k", header: t("growth.templates.kind"), cell: (r) => <code className="text-xs">{r.kind}</code> },
            { key: "p", header: t("growth.templates.purpose"), cell: (r) => <StatusChip tone={r.purpose === "MARKETING" ? "warning" : r.purpose === "REMINDER" ? "info" : "neutral"}>{t(`growth.templates.purposes.${r.purpose}`)}</StatusChip> },
            { key: "c", header: t("growth.templates.consent"), cell: (r) => <span className="text-xs">{t(`growth.templates.consentClass.${r.consentClass}`)}</span> },
            { key: "q", header: t("growth.templates.quiet"), cell: (r) => r.quietHoursBypass ? t("growth.common.yes") : t("growth.common.no") },
            { key: "l", header: t("growth.templates.locales"), cell: (r) => `${r.hasAr ? "AR" : ""}${r.hasAr && r.hasEn ? " · " : ""}${r.hasEn ? "EN" : ""}` },
            { key: "m", header: t("growth.templates.meta"), cell: (r) => <StatusChip tone={r.metaApproval === "ID_SET" ? "success" : "warning"}>{t(`growth.templates.metaState.${r.metaApproval}`)}</StatusChip> },
            { key: "b", header: t("growth.templates.body"), cell: (r) => <span className="line-clamp-2 max-w-sm text-xs" dir={ar ? "rtl" : "ltr"}>{ar ? r.ar : r.en}</span> },
          ]} />
        </Section>)}
    </GrowthPage>
  );
}
