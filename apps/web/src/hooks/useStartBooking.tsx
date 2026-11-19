import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError } from "@/api/errors";
import { useCreateHold } from "@/api/hooks";
import type { Slot } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { track } from "@/lib/analytics";
import { usePatient } from "./usePatient";

/** The API returns alternatives as {startsAt, endsAt}; slot identity is startsAt. */
export const altSlots = (raw: unknown, visitTypeId: string): Slot[] =>
  ((raw as { startsAt: string; endsAt: string }[] | undefined) ?? []).slice(0, 3).map((s) => ({ slotId: s.startsAt, startsAt: s.startsAt, endsAt: s.endsAt, visitTypeId }));

/** Slot pick → 5-minute hold (KXMBK02) → checkout. On 409 SLOT_TAKEN exposes the alternatives (KXMBK04). */
export function useStartBooking() {
  const nav = useNavigate();
  const { t } = useTranslation();
  const { status, login } = useAuth();
  const { selectedId, dependantId } = usePatient();
  const hold = useCreateHold();
  const [alternatives, setAlternatives] = useState<Slot[] | null>(null);
  const [takenDoctorId, setTakenDoctorId] = useState<string | null>(null);

  const start = (doctorId: string, slot: Slot) => {
    if (status !== "signedIn") { void login(`/doctors/${doctorId}?vt=${encodeURIComponent(slot.visitTypeId)}&slot=${encodeURIComponent(slot.slotId)}`); return; }
    if (!selectedId) return;
    hold.mutate({ providerId: doctorId, slot, dependantId }, {
      onSuccess: (b) => { track("booking_started", { providerId: doctorId }); nav(`/checkout/${b.id}`); },
      onError: (e) => {
        if (e instanceof ApiError && e.code === "SLOT_TAKEN") {
          track("booking_failed", { code: "SLOT_TAKEN", providerId: doctorId });
          setTakenDoctorId(doctorId);
          setAlternatives(altSlots(e.details?.alternatives, slot.visitTypeId));
        } else if (e instanceof ApiError && e.isFeatureDisabled) toast.error(t("unavailable.title"));
        else { track("booking_failed", { code: e instanceof ApiError ? e.code : "UNKNOWN", doctorId }); toast.error(t("booking.holdFailed")); }
      },
    });
  };
  return { start, isPending: hold.isPending, alternatives, takenDoctorId, clearAlternatives: () => setAlternatives(null) };
}
