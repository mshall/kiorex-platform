import { ApiError } from "@/api/errors";

export interface OpenSlot { startsAt: string; endsAt: string }
/** POST /waitlist answers 409 SLOTS_AVAILABLE {nextSlots, openSlotCount} when the doctor already has open slots: book directly instead of joining. */
export function slotsAvailable(e: unknown): { nextSlots: OpenSlot[]; openSlotCount: number } | null {
  if (!(e instanceof ApiError) || e.status !== 409 || e.code !== "SLOTS_AVAILABLE") return null;
  const slots = Array.isArray(e.details?.nextSlots) ? (e.details!.nextSlots as OpenSlot[]) : [];
  return { nextSlots: slots.filter((s) => s && typeof s.startsAt === "string"), openSlotCount: Number(e.details?.openSlotCount ?? slots.length) };
}
