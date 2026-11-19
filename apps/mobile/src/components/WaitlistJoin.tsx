import { useState } from "react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/errors";
import { useJoinWaitlist } from "@/api/features";
import { useAuth } from "@/auth/AuthProvider";
import { Banner, Button, Card, Chip, Row, Sheet, T } from "@/components/ui";
import { usePatient } from "@/hooks/usePatient";
import { track } from "@/lib/analytics";
import { formatDayLong, formatTime } from "@/lib/format";
import { slotsAvailable, type OpenSlot } from "@/lib/waitlist";

const WINDOWS = [{ k: "any", days: 0 }, { k: "week", days: 7 }, { k: "twoWeeks", days: 14 }] as const;

/** "Nothing suits me" → join the doctor's waitlist (KXM-BK-12); offers arrive in the Waitlist screen. Idempotent per patient+doctor+visit type. */
export function WaitlistJoin({ providerId, typeId }: { providerId: string; typeId: string | undefined }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { status } = useAuth();
  const { selected } = usePatient();
  const join = useJoinWaitlist();
  const [open, setOpen] = useState(false);
  const [win, setWin] = useState<(typeof WINDOWS)[number]["k"]>("any");
  const [result, setResult] = useState<"joined" | "error" | "off" | "available" | null>(null);
  const [slots, setSlots] = useState<OpenSlot[]>([]);

  const submit = () => {
    const days = WINDOWS.find((w) => w.k === win)!.days;
    const from = new Date();
    join.mutate({ providerId, typeId: typeId!, dependantId: selected?.dependantId, ...(days ? { preferredFrom: from.toISOString(), preferredTo: new Date(from.getTime() + days * 86_400_000).toISOString() } : {}) }, {
      onSuccess: () => { track("waitlist_joined", { providerId }); setResult("joined"); },
      onError: (e) => {
        const open = slotsAvailable(e); // the doctor has open slots: never join, offer to book directly
        if (open) { setSlots(open.nextSlots); setResult("available"); return; }
        setResult(e instanceof ApiError && e.isFeatureDisabled ? "off" : "error");
      },
    });
  };
  return (
    <>
      <Card testID="waitlist-card" style={{ gap: 8 }}>
        <T variant="h2">{t("waitlist.cardTitle")}</T>
        <T variant="small" muted>{t("waitlist.cardBody")}</T>
        <Button testID="join-waitlist" variant="secondary" icon="clock" disabled={!typeId} title={t("waitlist.join")}
          onPress={() => { if (status !== "signedIn") { router.push({ pathname: "/sign-in", params: { next: `/doctor/${providerId}` } }); return; } setResult(null); setOpen(true); }} />
      </Card>
      <Sheet visible={open} onClose={() => setOpen(false)} title={t("waitlist.join")} testID="waitlist-sheet"
        footer={result === "available" ? <Button testID="book-directly" title={t("waitlist.bookDirectly")} onPress={() => setOpen(false)} /> : result === "joined" ? <Button testID="view-waitlist" title={t("waitlist.view")} onPress={() => { setOpen(false); router.push("/waitlist"); }} /> : <Button testID="confirm-waitlist" loading={join.isPending} title={t("waitlist.confirmJoin")} onPress={submit} />}>
        {result === "available" ? (
          <>
            <Banner tone="success" title={t("waitlist.slotsAvailableTitle")} body={t("waitlist.slotsAvailableBody")} testID="waitlist-slots-available" />
            {slots.map((sl) => <T key={sl.startsAt} testID={`open-slot-${sl.startsAt}`} variant="small">{formatDayLong(sl.startsAt, i18n.language)} · {formatTime(sl.startsAt, i18n.language)}</T>)}
          </>
        ) : result === "joined" ? <Banner tone="success" title={t("waitlist.joinedTitle")} body={t("waitlist.joinedBody")} testID="waitlist-joined" /> : (
          <>
            <T muted>{t("waitlist.sheetBody")}</T>
            <T variant="label">{t("waitlist.window")}</T>
            <Row style={{ flexWrap: "wrap" }}>{WINDOWS.map((w) => <Chip key={w.k} testID={`wl-${w.k}`} label={t(`waitlist.windows.${w.k}`)} selected={win === w.k} onPress={() => setWin(w.k)} />)}</Row>
            {result === "off" ? <Banner tone="warning" body={t("unavailable.body")} /> : result === "error" ? <Banner tone="danger" body={t("waitlist.joinFailed")} /> : null}
          </>
        )}
      </Sheet>
    </>
  );
}
