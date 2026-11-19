import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, send } from "./client";
import { mapProfile, mapReviews, mapSearch, mapSlot, mapSpecialty } from "./adapters";
import type { Booking, ConsentPurpose, FlagsEffective, SearchParams } from "./types";
import { pollIntervalFor } from "@/lib/booking-state";

const NEXT: Record<number, string> = { 1: "today", 3: "tomorrow", 7: "week" };

export const qk = {
  flags: ["flags"] as const, specialties: ["specialties"] as const, search: (p: SearchParams) => ["search", p] as const,
  doctor: (id: string) => ["doctor", id] as const, slots: (id: string, vt: string, from?: string) => ["slots", id, vt, from] as const, reviews: (id: string) => ["reviews", id] as const,
  me: ["me"] as const, family: ["family"] as const, consents: ["consents"] as const, sessions: ["sessions"] as const, myReviews: ["my-reviews"] as const,
  bookings: ["bookings"] as const, booking: (id: string) => ["booking", id] as const,
};

export const useFlags = () => useQuery({ queryKey: qk.flags, queryFn: () => send<FlagsEffective>(api.GET("/api/v1/flags/effective")), staleTime: 30_000, retry: 0 });

export const useSpecialties = () =>
  useQuery({ queryKey: qk.specialties, staleTime: 3_600_000, queryFn: async () => (await send(api.GET("/api/v1/specialties"))).map(mapSpecialty) });

export const useSearchDoctors = (p: SearchParams, enabled = true) =>
  useQuery({
    queryKey: qk.search(p), enabled, placeholderData: keepPreviousData,
    queryFn: async () => {
      const { availableWithinDays, ...rest } = p;
      const query: Record<string, string> = {};
      for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== "" && v !== false) query[k] = String(v);
      if (availableWithinDays) query.nextAvailable = NEXT[availableWithinDays] ?? "week";
      return mapSearch(await send(api.GET("/api/v1/search/providers", { params: { query } as never })));
    },
  });

export const useDoctor = (id: string) =>
  useQuery({ queryKey: qk.doctor(id), enabled: !!id, queryFn: async () => mapProfile(await send(api.GET("/api/v1/providers/{id}", { params: { path: { id } } }))) });

/** Slots for a visit type over the next 7 days (the API default window). Refetched every 60 s (cache TTL). */
export const useSlots = (id: string, visitTypeId: string | undefined) =>
  useQuery({
    queryKey: qk.slots(id, visitTypeId ?? ""), enabled: !!visitTypeId, refetchInterval: 60_000,
    queryFn: async () => {
      const from = new Date(); const to = new Date(from.getTime() + 14 * 86_400_000);
      const r = await send(api.GET("/api/v1/providers/{id}/slots", { params: { path: { id }, query: { typeId: visitTypeId!, from: from.toISOString(), to: to.toISOString() } } }));
      return r.slots.map((s) => mapSlot(s, visitTypeId!));
    },
  });

export const useDoctorReviews = (id: string) =>
  useQuery({ queryKey: qk.reviews(id), enabled: !!id, queryFn: async () => mapReviews(await send(api.GET("/api/v1/providers/{id}/reviews", { params: { path: { id } } }))) });

// ---- account ----
export const useMe = (enabled = true) => useQuery({ queryKey: qk.me, enabled, queryFn: () => send(api.GET("/api/v1/me/profile")) });
export const useFamily = (enabled = true) => useQuery({ queryKey: qk.family, enabled, queryFn: () => send(api.GET("/api/v1/me/dependants")) });
export const useAddFamily = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { nameEn: string; dateOfBirth: string; relationship: "CHILD" | "PARENT" | "SPOUSE" | "OTHER"; gender?: "MALE" | "FEMALE" }) => send(api.POST("/api/v1/me/dependants", { body: b as never })),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.family }),
  });
};
export const useRemoveFamily = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => send(api.DELETE("/api/v1/me/dependants/{id}", { params: { path: { id } } })), onSuccess: () => qc.invalidateQueries({ queryKey: qk.family }) });
};
export const useConsents = (enabled = true) => useQuery({ queryKey: qk.consents, enabled, queryFn: () => send(api.GET("/api/v1/me/consents")) });
export const useSetConsent = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { purpose: ConsentPurpose; granted: boolean }) => send(api.PUT("/api/v1/me/consents/{purpose}", { params: { path: { purpose: v.purpose } }, body: { granted: v.granted } as never })),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.consents }),
  });
};
export const useSessions = (enabled = true) => useQuery({ queryKey: qk.sessions, enabled, queryFn: () => send(api.GET("/api/v1/me/sessions")) });
export const useRevokeSession = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => send(api.DELETE("/api/v1/me/sessions/{id}", { params: { path: { id } } })), onSuccess: () => qc.invalidateQueries({ queryKey: qk.sessions }) });
};
export const useRequestExport = () => useMutation({ mutationFn: () => send(api.POST("/api/v1/me/export")) });
/** In-app deletion (KXM-AC-06). includeExport returns the export payload in the response. */
export const useDeleteAccount = () =>
  useMutation({ mutationFn: (includeExport: boolean) => send(api.POST("/api/v1/me/deletion", { body: { confirm: true, includeExport } })) });

// ---- bookings ----
export const useBookings = (enabled = true) =>
  useQuery({ queryKey: qk.bookings, enabled, queryFn: () => send(api.GET("/api/v1/bookings", { params: { query: {} as never } })) });

export const useBooking = (id: string, opts?: { poll?: boolean }) =>
  useQuery({
    queryKey: qk.booking(id), enabled: !!id,
    refetchInterval: (q) => (opts?.poll ? pollIntervalFor(q.state.data?.status) : false),
    queryFn: () => send(api.GET("/api/v1/bookings/{id}", { params: { path: { id } } })),
  });

export const useMyReviews = (enabled = true) => useQuery({ queryKey: qk.myReviews, enabled, queryFn: () => send(api.GET("/api/v1/me/reviews")) });

const useBookingWrite = <V,>(fn: (v: V) => Promise<Booking>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: V) => fn(v),
    onSuccess: (b) => { qc.setQueryData(qk.booking(b.id), b); void qc.invalidateQueries({ queryKey: qk.bookings }); },
  });
};

/** Slot pick → intent + 5-minute hold (KXMBK02). On 409 SLOT_TAKEN the error carries `alternatives` (KXMBK04). */
export const useCreateHold = () =>
  useBookingWrite((v: { providerId: string; typeId: string; startsAt: string; endsAt?: string; dependantId?: string }) => send(api.POST("/api/v1/bookings", { body: v as never })));

/** Confirm. The server uses the booking id as Kiorly's Idempotency-Key, so a retry can never create a second booking (KXMBK03/05). */
export const useConfirmBooking = () =>
  useBookingWrite((v: { id: string; marketplaceConsent: boolean; remindersConsent: boolean }) =>
    send(api.POST("/api/v1/bookings/{id}/confirm", { params: { path: { id: v.id } }, body: { marketplaceConsent: v.marketplaceConsent, remindersConsent: v.remindersConsent } as never })));
export const useReleaseHold = () => useBookingWrite((id: string) => send(api.POST("/api/v1/bookings/{id}/release", { params: { path: { id } } })));
export const useCancelBooking = () => useBookingWrite((v: { id: string; reason?: string }) => send(api.POST("/api/v1/bookings/{id}/cancel", { params: { path: { id: v.id } }, body: { reason: v.reason } as never })));
export const useRescheduleBooking = () =>
  useBookingWrite((v: { id: string; startsAt: string; endsAt?: string }) => send(api.POST("/api/v1/bookings/{id}/reschedule", { params: { path: { id: v.id } }, body: { startsAt: v.startsAt, endsAt: v.endsAt } as never })));

export const useDepositCheckout = () =>
  useMutation({ mutationFn: (id: string) => send(api.POST("/api/v1/bookings/{id}/deposit-checkout", { params: { path: { id } } })) });

export const useSubmitReview = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { bookingId: string; rating: number; text?: string }) => send(api.POST("/api/v1/bookings/{id}/review", { params: { path: { id: v.bookingId } }, body: { rating: v.rating, text: v.text } as never })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: qk.myReviews }); void qc.invalidateQueries({ queryKey: qk.bookings }); },
  });
};
