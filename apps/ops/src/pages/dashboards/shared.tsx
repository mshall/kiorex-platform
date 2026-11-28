import { useTranslation } from "react-i18next";
import { Card, Figures, Rows, arr, num, useAge, useDash, when } from "@/components/dash/Dash";

/** Join requests from the Kiorly site: counts and the oldest waiting. No contact details, only the reference, type, market and age. */
export function JoinRequestsCard({ to = "/leads" }: { to?: string }) {
  const { t, i18n } = useTranslation(); const age = useAge();
  const sum = useDash<{ byStatus: Record<string, number>; newLastSevenDays: number; unassignedOpen: number }>("lead-summary", "/admin/leads/summary");
  const list = useDash<{ items: Array<{ id: string; ref: string; providerType: string; market: string; createdAt: string; status: string }> }>("lead-new", "/admin/leads?status=NEW&pageSize=100");
  const oldest = [...arr<{ id: string; ref: string; providerType: string; market: string; createdAt: string }>(list.data)].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)).slice(0, 5);
  return (
    <Card id="join-requests" title={t("roleHome.joinRequests.title")} hint={t("roleHome.joinRequests.hint")} to={to} q={[sum, list]}>
      <Figures items={[
        { label: t("roleHome.joinRequests.new"), value: num(sum.data?.byStatus?.NEW ?? 0), tone: (sum.data?.byStatus?.NEW ?? 0) > 0 ? "warn" : undefined, testid: "dash-new-count" },
        { label: t("roleHome.joinRequests.last7"), value: num(sum.data?.newLastSevenDays ?? 0) },
        { label: t("roleHome.joinRequests.unassigned"), value: num(sum.data?.unassignedOpen ?? 0) },
      ]} />
      <h3 className="text-xs font-semibold text-muted-foreground">{t("roleHome.joinRequests.oldest")}</h3>
      <Rows testid="dash-oldest" empty={t("roleHome.joinRequests.none")} rows={oldest.map((r) => ({ key: r.id, primary: r.ref, secondary: `${r.providerType} · ${r.market}`, end: `${age(r.createdAt)} · ${when(r.createdAt, i18n.language)}` }))} />
    </Card>
  );
}

/** Partner (provider) onboarding queue: connection requests by state. */
export function PartnerQueueCard({ awaitingOnly = false }: { awaitingOnly?: boolean }) {
  const { t } = useTranslation();
  const q = useDash<Array<{ id: string; kind: string; name: string; market: string; status: string; progress: number; humanActions: string[] }>>("partners", "/admin/onboarding/partners");
  const rows = arr<{ id: string; kind: string; name: string; market: string; status: string; progress: number; humanActions: string[] }>(q.data);
  const open = rows.filter((r) => !["LIVE", "REJECTED"].includes(r.status));
  const shown = (awaitingOnly ? open.filter((r) => r.status === "AWAITING_APPROVAL") : open).slice(0, 6);
  const by = (s: string) => rows.filter((r) => r.status === s).length;
  return (
    <Card id="partner-queue" title={t("roleHome.partnerQueue.title")} hint={t("roleHome.partnerQueue.hint")} to="/partner-onboarding" q={[q]}>
      <Figures items={[
        { label: t("roleHome.partnerQueue.open"), value: num(open.length), testid: "dash-partner-open" },
        { label: t("roleHome.partnerQueue.changes"), value: num(by("CHANGES_REQUESTED")) },
        { label: t("roleHome.partnerQueue.awaiting"), value: num(by("AWAITING_APPROVAL")), tone: by("AWAITING_APPROVAL") > 0 ? "warn" : undefined, testid: "dash-partner-awaiting" },
      ]} />
      <Rows testid="dash-partner-rows" empty={t("roleHome.partnerQueue.none")} rows={shown.map((r) => ({ key: r.id, primary: r.name, secondary: `${r.kind} · ${r.market} · ${r.status}`, end: `${num(r.progress)}%` }))} />
    </Card>
  );
}

/** Onboarding import drafts (batches). Counts by state and the newest few. */
export function ImportDraftsCard() {
  const { t } = useTranslation(); const age = useAge();
  const q = useDash<Array<{ id: string; orgName: string; label?: string | null; status: string; createdAt: string }>>("imports", "/admin/onboarding/imports");
  const rows = arr<{ id: string; orgName: string; label?: string | null; status: string; createdAt: string }>(q.data);
  const drafts = rows.filter((r) => !["COMMITTED", "ROLLED_BACK", "PURGED"].includes(r.status));
  return (
    <Card id="import-drafts" title={t("roleHome.imports.title")} hint={t("roleHome.imports.hint")} to="/onboarding" q={[q]}>
      <Figures items={[{ label: t("roleHome.imports.drafts"), value: num(drafts.length), testid: "dash-drafts" }, { label: t("roleHome.imports.total"), value: num(rows.length) }]} />
      <Rows testid="dash-draft-rows" empty={t("roleHome.imports.none")} rows={drafts.slice(0, 5).map((r) => ({ key: r.id, primary: r.orgName, secondary: r.label ?? r.status, end: `${r.status} · ${age(r.createdAt)}` }))} />
    </Card>
  );
}
