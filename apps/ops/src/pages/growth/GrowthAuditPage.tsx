import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGrowthAudit, type AuditFilter } from "@/api/growth";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { GrowthPage, Section } from "@/components/growth/GrowthPage";
import { formatDateTime, localToIso } from "@/lib/format";

/** Audit logs: every growth audit event (config transitions, channel, widget and fraud actions) with filters. Metadata holds checksums and states, never payloads or secrets. */
export default function GrowthAuditPage() {
  const { t, i18n } = useTranslation();
  const [f, setF] = useState({ action: "", actor: "", from: "", to: "" }); const [applied, setApplied] = useState<AuditFilter>({}); const [before, setBefore] = useState<string | undefined>();
  const q = useGrowthAudit({ ...applied, before });
  const apply = () => { setBefore(undefined); setApplied({ action: f.action.trim() || undefined, actor: f.actor.trim() || undefined, from: localToIso(f.from), to: localToIso(f.to) }); };
  return (
    <GrowthPage section="audit">
      <Section title={t("growth.audit.filters")} id="au-filters">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); apply(); }}>
          <label className="space-y-1 text-sm"><span className="block font-medium">{t("growth.audit.action")}</span><Input dir="ltr" className="w-56" placeholder="growth.config." value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} data-testid="audit-action" /></label>
          <label className="space-y-1 text-sm"><span className="block font-medium">{t("growth.audit.actor")}</span><Input dir="ltr" className="w-48" value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })} data-testid="audit-actor" /></label>
          <label className="space-y-1 text-sm"><span className="block font-medium">{t("growth.audit.from")}</span><Input type="datetime-local" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
          <label className="space-y-1 text-sm"><span className="block font-medium">{t("growth.audit.to")}</span><Input type="datetime-local" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
          <Button type="submit" data-testid="audit-apply">{t("growth.audit.apply")}</Button>
        </form>
      </Section>
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data && (
        <Section title={t("growth.audit.events")} id="au-events">
          <DataTable caption={t("growth.audit.events")} rows={q.data.items} rowKey={(r) => r.id} empty={t("growth.audit.empty")} columns={[
            { key: "at", header: t("growth.audit.when"), cell: (r) => <span className="kx-label-num text-xs">{formatDateTime(r.createdAt, i18n.language)}</span> }, { key: "a", header: t("growth.audit.actor"), cell: (r) => <code className="text-xs">{r.actor}</code> },
            { key: "ac", header: t("growth.audit.action"), cell: (r) => <code className="text-xs">{r.action}</code> }, { key: "r", header: t("growth.audit.resource"), cell: (r) => <span className="text-xs">{r.resource}{r.resourceId ? ` · ${r.resourceId.slice(0, 12)}` : ""}</span> },
            { key: "m", header: t("growth.audit.details"), cell: (r) => <code className="line-clamp-2 max-w-xs break-all text-[11px]" dir="ltr">{JSON.stringify(r.metadata ?? {})}</code> },
          ]} />
          <div className="mt-3 flex gap-2">{before && <Button variant="outline" size="sm" onClick={() => setBefore(undefined)}>{t("growth.audit.newest")}</Button>}{q.data.nextBefore && <Button variant="outline" size="sm" onClick={() => setBefore(q.data!.nextBefore!)} data-testid="audit-older">{t("growth.audit.older")}</Button>}</div>
        </Section>)}
    </GrowthPage>
  );
}
