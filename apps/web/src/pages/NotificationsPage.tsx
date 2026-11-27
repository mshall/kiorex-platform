import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Bell, BellOff, CalendarCheck, FileText, FlaskConical, Hourglass, Pill, RotateCcw, Truck, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/states";
import { IconTile, PageHeader, StatusChip } from "@/components/kit";
import { useMarkRead, useNotificationPrefs, useNotifications, useSetNotificationPref, type InboxItem, type NotificationPref } from "@/api/engagement";
import { formatDay, formatTime } from "@/lib/format";

const KIND_ICON: Record<string, typeof Bell> = { BOOKING_CONFIRMED: CalendarCheck, REMINDER_24H: CalendarCheck, REMINDER_2H: CalendarCheck, WAITLIST_OFFER: Hourglass, RECORD_SHARED: FileText, LAB_RESULT_RELEASED: FlaskConical, PHARMACY_ORDER_READY: Pill, PHARMACY_ORDER_OUT_FOR_DELIVERY: Truck, PHARMACY_ORDER_PARTIAL_REFUND: RotateCcw, PHARMACY_ORDER_DISPENSED: Pill, TELEMEDICINE_STARTING: Video };

/** Where a notification leads. Unknown kinds fall back to the appointment (when it has one) or nothing. */
function target(n: InboxItem): string | null {
  if (n.kind === "WAITLIST_OFFER") return "/waitlist";
  if (n.kind === "LAB_RESULT_RELEASED") return "/lab/bookings";
  if (n.kind === "RECORD_SHARED" || n.kind === "FOLLOW_UP_DUE") return "/records";
  if (n.kind.startsWith("PHARMACY")) return "/pharmacy/orders";
  return n.bookingId ? `/appointments/${n.bookingId}` : null;
}

function Inbox() {
  const { t, i18n } = useTranslation();
  const q = useNotifications();
  const mark = useMarkRead();
  if (q.isLoading) return <CardSkeleton rows={3} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const items = q.data ?? [];
  if (!items.length) return <EmptyState icon={<BellOff className="h-10 w-10" aria-hidden="true" />} title={t("notifications.empty")} hint={t("notifications.emptyHint")} />;
  return (
    <ul className="space-y-3" data-testid="notification-list">
      {items.map((n) => {
        const Icon = KIND_ICON[n.kind] ?? Bell;
        const to = target(n);
        const unread = !n.readAt;
        return (
          <li key={n.id} className="kx-card flex items-start gap-3 p-4" data-testid="notification" data-unread={unread}>
            <IconTile tone={unread ? "brand" : "neutral"}><Icon /></IconTile>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="flex flex-wrap items-center gap-2 font-medium">{t(`notifications.kind.${n.kind}`, { defaultValue: t("notifications.kind.OTHER") })}{unread && <StatusChip tone="info" dot={false}>{t("notifications.new")}</StatusChip>}</p>
              <p className="text-sm">{n.body}</p>
              <p className="text-xs text-muted-foreground">{formatDay(n.createdAt, i18n.language)} · {formatTime(n.createdAt, i18n.language)}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                {to && <Button asChild size="sm" variant="outline"><Link to={to} onClick={() => unread && mark.mutate(n.id)}>{t("notifications.open")}</Link></Button>}
                {unread && <Button size="sm" variant="ghost" onClick={() => mark.mutate(n.id, { onError: () => toast.error(t("states.errorTitle")) })}>{t("notifications.markRead")}</Button>}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function Preferences() {
  const { t } = useTranslation();
  const q = useNotificationPrefs();
  const set = useSetNotificationPref();
  if (q.isLoading) return <CardSkeleton rows={2} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const save = (p: NotificationPref, patch: { enabled?: boolean; quietStart?: number; quietEnd?: number }) =>
    set.mutate({ channel: p.channel, ...patch }, { onSuccess: () => toast.success(t("notifications.prefSaved")), onError: () => toast.error(t("states.errorTitle")) });
  return (
    <div>
    <ul className="space-y-3" data-testid="notification-prefs">
      {(q.data ?? []).map((p) => (
        <li key={p.channel} className="kx-card space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`np-${p.channel}`} className="text-base">{t(`notifications.channel.${p.channel}`)}</Label>
            <Switch id={`np-${p.channel}`} checked={p.enabled} onCheckedChange={(enabled) => save(p, { enabled })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["quietStart", "quietEnd"] as const).map((k) => (
              <div key={k} className="space-y-1">
                <Label htmlFor={`np-${p.channel}-${k}`} className="text-sm text-muted-foreground">{t(`notifications.${k}`)}</Label>
                <select id={`np-${p.channel}-${k}`} disabled={!p.enabled} value={p[k] ?? ""} onChange={(e) => e.target.value !== "" && save(p, { [k]: Number(e.target.value) })} className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm disabled:opacity-50">
                  <option value="">{t("notifications.none")}</option>
                  {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
                </select>
              </div>
            ))}
          </div>
        </li>
      ))}
    </ul>
    <p className="mt-3 text-xs text-muted-foreground">{t("notifications.safetyNote")}</p>
    </div>
  );
}

export default function NotificationsPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t("notifications.title")} hint={t("notifications.intro")} icon={<Bell />} />
      <Inbox />
      <section className="space-y-3" aria-labelledby="np-h"><h2 id="np-h" className="text-xl">{t("notifications.prefs")}</h2><p className="text-sm text-muted-foreground">{t("notifications.prefsHint")}</p><Preferences /></section>
    </div>
  );
}
