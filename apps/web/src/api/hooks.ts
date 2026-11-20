import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./client";
import type { Booking, ConsentType, SearchParams, Slot } from "./types";
import { mapBooking, mapConsent, mapDependant, mapPatient, mapProfile, mapReviews, mapSearch, mapSession, mapSlot, mapSpecialty } from "./adapters";


export const qk = {
  flags: ["flags"] as const, specialties: ["specialties"] as const, search: (p: SearchParams) => ["search", p] as const, doctor: (id: string) => ["doctor", id] as const,
  slots: (id: string, vt: string, from?: string, to?: string) => ["slots", id, vt, from, to] as const, reviews: (id: string) => ["reviews", id] as const,
  me: ["me"] as const, family: ["family"] as const, consents: ["consents"] as const, sessions: ["sessions"] as const, bookings: ["bookings"] as const, booking: (id: string) => ["booking", id] as const,
};

export const useFlags = () =>
  useQuery({ queryKey: qk.flags, queryFn: () => unwrap(api.GET("/api/v1/flags/effective")), staleTime: 30_000, retry: 0 });

// ───── catalog ─────
export const useSpecialties = () =>
  useQuery({ queryKey: qk.specialties, queryFn: async () => (await unwrap(api.GET("/api/v1/specialties"))).map(mapSpecialty), staleTime: 3_600_000 });

const NEXT: Record<number, string> = { 1: "today", 3: "tomorrow", 7: "week" };
export const useSearchDoctors = (p: SearchParams, enabled = true) =>
  useQuery({
    queryKey: qk.search(p), enabled, placeholderData: keepPreviousData,
    queryFn: async () => {
      const { availableWithinDays, ...rest } = p;
      const query: Record<string, string> = {};
      for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== "" && v !== false) query[k] = String(v);
      if (availableWithinDays) query.nextAvailable = NEXT[availableWithinDays] ?? "week";
      return mapSearch(await unwrap(api.GET("/api/v1/search/providers", { params: { query: query } })));
    },
  });

export const useDoctor = (id: string) =>
  useQuery({ queryKey: qk.doctor(id), enabled: !!id, queryFn: async () => mapProfile(await unwrap(api.GET("/api/v1/providers/{id}", { params: { path: { id } } }))) });

export const useSlots = (id: string, visitTypeId: string | undefined, from?: string, to?: string) =>
  useQuery({
    queryKey: qk.slots(id, visitTypeId ?? "", from, to), enabled: !!visitTypeId, refetchInterval: 60_000,
    queryFn: async () => {
      const r = await unwrap(api.GET("/api/v1/providers/{id}/slots", { params: { path: { id }, query: { typeId: visitTypeId!, ...(from ? { from } : {}), ...(to ? { to } : {}) } } }));
      return (r.slots ?? []).map((s) => mapSlot(s, visitTypeId!));
    },
  });

export const useDoctorReviews = (id: string) =>
  useQuery({ queryKey: qk.reviews(id), queryFn: async () => mapReviews(await unwrap(api.GET("/api/v1/providers/{id}/reviews", { params: { path: { id } } }))) });

// ───── account ─────
export const useMe = (enabled = true) => useQuery({ queryKey: qk.me, enabled, queryFn: async () => mapPatient(await unwrap(api.GET("/api/v1/me/profile"))) });
export const useFamily = (enabled = true) => useQuery({ queryKey: qk.family, enabled, queryFn: async () => (await unwrap(api.GET("/api/v1/me/dependants"))).map(mapDependant) });

export interface FamilyInput { nameEn: string; dateOfBirth: string; relationship: "CHILD" | "PARENT" | "SPOUSE" | "OTHER"; gender?: "MALE" | "FEMALE" }
export const useAddFamily = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: FamilyInput) => unwrap(api.POST("/api/v1/me/dependants", { body: body })), onSuccess: () => qc.invalidateQueries({ queryKey: qk.family }) });
};
export const useRemoveFamily = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => unwrap(api.DELETE("/api/v1/me/dependants/{id}", { params: { path: { id } } })), onSuccess: () => qc.invalidateQueries({ queryKey: qk.family }) });
};

export const useConsents = (enabled = true) => useQuery({ queryKey: qk.consents, enabled, queryFn: async () => (await unwrap(api.GET("/api/v1/me/consents"))).map(mapConsent) });
export const useSetConsent = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { type: ConsentType; granted: boolean }) => unwrap(api.PUT("/api/v1/me/consents/{purpose}", { params: { path: { purpose: v.type.toUpperCase() } }, body: { granted: v.granted } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.consents }),
  });
};

export const useSessions = (enabled = true) => useQuery({ queryKey: qk.sessions, enabled, queryFn: async () => (await unwrap(api.GET("/api/v1/me/sessions"))).map(mapSession) });
export const useRevokeSession = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => unwrap(api.DELETE("/api/v1/me/sessions/{id}", { params: { path: { id } } })), onSuccess: () => qc.invalidateQueries({ queryKey: qk.sessions }) });
};

/** KXMAC06: in-app deletion. With includeExport the response carries the data export. */
export const useDeleteAccount = () =>
  useMutation({ mutationFn: (includeExport: boolean) => unwrap(api.POST("/api/v1/me/deletion", { body: { confirm: true, includeExport } })) });

// ───── bookings ─────
export const useBookings = (enabled = true) =>
  useQuery({ queryKey: qk.bookings, enabled, queryFn: async () => (await unwrap(api.GET("/api/v1/bookings"))).map(mapBooking) });

export const useBooking = (id: string, opts?: { poll?: boolean }) =>
  useQuery({
    queryKey: qk.booking(id),
    refetchInterval: (q) => (opts?.poll && (["HELD", "PENDING_CLINIC"].includes(q.state.data?.status ?? "") || (q.state.data?.serviceLocation === "HOME" && (["CONFIRMED", "CHECKED_IN"].includes(q.state.data.status) || (!!q.state.data.home?.aborted && q.state.data.deposit.status === "PAID")))) ? 5_000 : false),
    queryFn: async () => mapBooking(await unwrap(api.GET("/api/v1/bookings/{id}", { params: { path: { id } } }))),
  });

/** Visit-type name/fee are not part of the booking payload; resolve them from the provider profile. */
export function useVisitType(b: Booking | undefined) {
  const d = useDoctor(b?.doctor.id ?? "");
  return d.data?.visitTypes.find((v) => v.id === b?.visitType.id);
}

export const useCreateHold = () =>
  useMutation({
    mutationFn: async (v: { providerId: string; slot: Slot; dependantId?: string; home?: { addressId: string } }) =>
      mapBooking(await unwrap(api.POST("/api/v1/bookings", { body: { providerId: v.providerId, typeId: v.slot.visitTypeId, startsAt: v.slot.startsAt, endsAt: v.slot.endsAt, ...(v.dependantId ? { dependantId: v.dependantId } : {}), ...(v.home ? { serviceLocation: "HOME" as const, addressId: v.home.addressId } : {}) } }))),
  });

export const useConfirmBooking = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { bookingId: string; marketplaceConsent: boolean; remindersConsent: boolean }) =>
      mapBooking(await unwrap(api.POST("/api/v1/bookings/{id}/confirm", { params: { path: { id: v.bookingId } }, body: { marketplaceConsent: v.marketplaceConsent, remindersConsent: v.remindersConsent } }))),
    onSuccess: (b) => { qc.setQueryData(qk.booking(b.id), b); void qc.invalidateQueries({ queryKey: qk.bookings }); },
  });
};

/** KXMPAY01: hosted deposit checkout, started after the booking is accepted (API: POST /bookings/:id/deposit-checkout). */
export const useDepositCheckout = () =>
  useMutation({ mutationFn: (bookingId: string) => unwrap(api.POST("/api/v1/bookings/{id}/deposit-checkout", { params: { path: { id: bookingId } } })) });

export const useCancelBooking = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { bookingId: string; reason?: string }) => mapBooking(await unwrap(api.POST("/api/v1/bookings/{id}/cancel", { params: { path: { id: v.bookingId } }, body: { reason: v.reason } }))),
    onSuccess: (b) => { qc.setQueryData(qk.booking(b.id), b); void qc.invalidateQueries({ queryKey: qk.bookings }); },
  });
};

export const useRescheduleBooking = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { bookingId: string; slot: Slot }) => mapBooking(await unwrap(api.POST("/api/v1/bookings/{id}/reschedule", { params: { path: { id: v.bookingId } }, body: { startsAt: v.slot.startsAt, endsAt: v.slot.endsAt } }))),
    onSuccess: (b) => { qc.setQueryData(qk.booking(b.id), b); void qc.invalidateQueries({ queryKey: qk.bookings }); },
  });
};

export const useSubmitReview = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { bookingId: string; rating: number; text?: string }) => unwrap(api.POST("/api/v1/bookings/{id}/review", { params: { path: { id: v.bookingId } }, body: { rating: v.rating, text: v.text } })),
    onSuccess: (_r, v) => { void qc.invalidateQueries({ queryKey: qk.booking(v.bookingId) }); void qc.invalidateQueries({ queryKey: qk.bookings }); },
  });
};
