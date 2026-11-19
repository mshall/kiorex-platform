import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BellRing, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/auth/AuthProvider";
import { ApiError } from "@/api/errors";
import { useJoinWaitlist, useWaitlist } from "@/api/services";
import { usePatient } from "@/hooks/usePatient";
import { useFeature } from "@/hooks/useFeature";
import { formatDateTime } from "@/lib/format";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

const WINDOWS = [{ id: "any", days: 0 }, { id: "week", days: 7 }, { id: "twoWeeks", days: 14 }] as const;

/** BK-12: shown in the no-slot state of a doctor profile. Joining is idempotent per patient + doctor + visit type. */
export function WaitlistJoin({ providerId, typeId }: { providerId: string; typeId?: string }) {
  const { t, i18n } = useTranslation();
  const { status, login } = useAuth();
  const { dependantId } = usePatient();
  const list = useWaitlist(status === "signedIn");
  const join = useJoinWaitlist();
  const marketplace = useFeature("kiorex.marketplace");
  const [open, setOpen] = useState<{ startsAt: string; endsAt: string }[] | null>(null);
  const [win, setWin] = useState<(typeof WINDOWS)[number]["id"]>("any");
  const existing = list.data?.find((e) => e.providerId === providerId && e.typeId === typeId && ["WAITING", "OFFERED"].includes(e.status));

  if (!typeId || !marketplace.enabled) return null;
  if (existing) {
    return (
      <div className="kx-card flex flex-wrap items-center justify-between gap-3 p-5" data-testid="waitlist-joined">
        <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-5 w-5 text-success" aria-hidden="true" />{t("waitlist.onList")}</p>
        <Link className="text-sm text-ocean underline underline-offset-4" to="/waitlist">{t("waitlist.viewAll")}</Link>
      </div>
    );
  }
  if (open) {
    return (
      <div className="kx-card space-y-3 p-5" role="status" data-testid="waitlist-slots-available">
        <h3 className="text-lg">{t("waitlist.slotsAvailableTitle")}</h3><p className="text-sm text-muted-foreground">{t("waitlist.slotsAvailableBody")}</p>
        <div className="flex flex-wrap gap-2">{open.map((s) => <span key={s.startsAt} className="kx-chip">{formatDateTime(s.startsAt, i18n.language)}</span>)}</div>
        <Button onClick={() => window.location.reload()} data-testid="book-directly">{t("waitlist.bookDirectly")}</Button>
      </div>
    );
  }
  const submit = () => {
    if (status !== "signedIn") { void login(window.location.pathname); return; }
    const days = WINDOWS.find((w) => w.id === win)!.days;
    join.mutate({ providerId, typeId, ...(dependantId ? { dependantId } : {}), ...(days ? { preferredFrom: new Date().toISOString(), preferredTo: new Date(Date.now() + days * 86_400_000).toISOString() } : {}) }, {
      onSuccess: () => { track("waitlist_joined", { providerId }); toast.success(t("waitlist.joined")); },
      onError: (e) => {
        if (e instanceof ApiError && e.code === "SLOTS_AVAILABLE") { setOpen(((e.details?.nextSlots as { startsAt: string; endsAt: string }[] | undefined) ?? [])); return; }
        toast.error(e instanceof ApiError && e.isFeatureDisabled ? t("unavailable.title") : t("waitlist.joinFailed"));
      },
    });
  };
  return (
    <div className="kx-card space-y-4 p-5" data-testid="waitlist-join">
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 h-6 w-6 shrink-0 text-ocean" aria-hidden="true" />
        <div><h3 className="text-lg">{t("waitlist.joinTitle")}</h3><p className="text-sm text-muted-foreground">{t("waitlist.joinHint")}</p></div>
      </div>
      <div role="radiogroup" aria-label={t("waitlist.window")} className="flex flex-wrap gap-2">
        {WINDOWS.map((w) => (
          <button key={w.id} type="button" role="radio" aria-checked={win === w.id} data-active={win === w.id} className={cn("kx-chip")} onClick={() => setWin(w.id)}>{t(`waitlist.windows.${w.id}`)}</button>
        ))}
      </div>
      <Button onClick={submit} disabled={join.isPending} data-testid="waitlist-join-btn">{join.isPending ? t("states.loading") : t("waitlist.join")}</Button>
    </div>
  );
}
