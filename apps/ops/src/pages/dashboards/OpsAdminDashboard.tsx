import { useTranslation } from "react-i18next";
import { Card, Figures, Shortcuts, arr, num, useDash } from "@/components/dash/Dash";
import { JoinRequestsCard, PartnerQueueCard } from "./shared";

/** ops_admin: the Kiorex operations queues. Counts and links only; the detail lives on the screens. */
export default function OpsAdminDashboard() {
  const { t } = useTranslation();
  const moderation = useDash<unknown[]>("moderation", "/admin/moderation?status=OPEN");
  const complaints = useDash<unknown[]>("complaints", "/admin/complaints?status=OPEN");
  const outbox = useDash<{ stats?: { dead: number; pending: number } }>("outbox", "/admin/outbox");
  const held = useDash<unknown[]>("held", "/admin/payments/held-for-review");
  const safety = useDash<{ open: number; unacknowledged: number; sloBreaches: number; unsafeAborts: number }>("safety", "/admin/safety/summary");
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="dashboard-ops_admin">
      <Card id="trust" title={t("roleHome.ops.trustTitle")} hint={t("roleHome.ops.trustHint")} to="/moderation" q={[moderation, complaints]}>
        <Figures items={[{ label: t("roleHome.ops.moderation"), value: num(arr(moderation.data).length), tone: arr(moderation.data).length ? "warn" : undefined, testid: "dash-moderation" }, { label: t("roleHome.ops.complaints"), value: num(arr(complaints.data).length), testid: "dash-complaints" }]} />
      </Card>
      <Card id="safety" title={t("roleHome.ops.safetyTitle")} hint={t("roleHome.ops.safetyHint")} to="/safety" q={[safety, held]}>
        <Figures items={[
          { label: t("roleHome.ops.safetyOpen"), value: num(safety.data?.open ?? 0), tone: (safety.data?.open ?? 0) > 0 ? "danger" : "ok", testid: "dash-safety-open" },
          { label: t("roleHome.ops.safetyUnack"), value: num(safety.data?.unacknowledged ?? 0) },
          { label: t("roleHome.ops.heldDeposits"), value: num(arr(held.data).length), tone: arr(held.data).length ? "warn" : undefined, testid: "dash-held" },
        ]} />
      </Card>
      <Card id="outbox" title={t("roleHome.ops.outboxTitle")} hint={t("roleHome.ops.outboxHint")} to="/outbox" q={[outbox]}>
        <Figures items={[{ label: t("roleHome.health.dead"), value: num(outbox.data?.stats?.dead ?? 0), tone: (outbox.data?.stats?.dead ?? 0) > 0 ? "danger" : "ok", testid: "dash-outbox-dead" }, { label: t("roleHome.health.pending"), value: num(outbox.data?.stats?.pending ?? 0) }]} />
      </Card>
      <PartnerQueueCard />
      <JoinRequestsCard />
      <Card id="shortcuts" title={t("roleHome.shortcuts.title")} hint={t("roleHome.shortcuts.hintOps")}>
        <Shortcuts items={[{ to: "/bookings", label: t("nav.bookings") }, { to: "/orders", label: t("nav.orders") }, { to: "/liquidity", label: t("nav.liquidity") }, { to: "/reconciliation", label: t("nav.recon") }, { to: "/home-gate", label: t("nav.homeGate") }]} />
      </Card>
    </div>
  );
}
