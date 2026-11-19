import { useRef, useState } from "react";
import { useRouter } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { useCreateHold } from "@/api/hooks";
import type { DoctorProfile, Slot, DoctorSummary } from "@/api/types";
import { track } from "@/lib/analytics";
import { classifyBookingError } from "@/lib/booking-state";
import { usePatient } from "./usePatient";

/** Slot pick → 5-minute hold (KXMBK02) → checkout. 409 SLOT_TAKEN exposes the alternatives (KXMBK04). */
export function useStartBooking() {
  const router = useRouter();
  const { status } = useAuth();
  const { selected } = usePatient();
  const hold = useCreateHold();
  const [alternatives, setAlternatives] = useState<Slot[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [failed, setFailed] = useState(false);
  const lastDoctor = useRef<string | null>(null);

  const start = (doctor: Pick<DoctorSummary | DoctorProfile["summary"], "id">, slot: Slot) => {
    setFailed(false); setUnavailable(false); lastDoctor.current = doctor.id;
    if (status !== "signedIn") { router.push({ pathname: "/sign-in", params: { next: `/doctor/${doctor.id}` } }); return; }
    hold.mutate({ providerId: doctor.id, typeId: slot.visitTypeId, startsAt: slot.startsAt, endsAt: slot.endsAt, dependantId: selected?.dependantId }, {
      onSuccess: (b) => { track("booking_started", { providerId: doctor.id }); router.push(`/checkout/${b.id}`); },
      onError: (e) => {
        const a = classifyBookingError(e);
        track("booking_failed", { code: a.kind === "generic" ? a.code : a.kind.toUpperCase(), providerId: doctor.id });
        if (a.kind === "slot_taken") setAlternatives(a.alternatives.map((x) => ({ slotId: x.startsAt, startsAt: x.startsAt, endsAt: x.endsAt, visitTypeId: slot.visitTypeId })));
        else if (a.kind === "unavailable") setUnavailable(true);
        else setFailed(true);
      },
    });
  };
  /** Picks one of the 409 alternatives for the same doctor. */
  const startAlternative = (slot: Slot) => { setAlternatives(null); if (lastDoctor.current) start({ id: lastDoctor.current }, slot); };
  return { start, startAlternative, isPending: hold.isPending, alternatives, unavailable, failed, clearAlternatives: () => setAlternatives(null) };
}
