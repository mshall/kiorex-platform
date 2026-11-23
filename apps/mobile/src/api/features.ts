// NOTE: the spec marks several OPTIONAL query params as required (kind, pharmacyId, labId, specialty); those casts are deliberate (reported as an API spec bug).
// Patient feature hooks (waitlist, records vault, pharmacy, lab, telemedicine, markets, analytics) against the REAL Kiorex API.
// Response/request types come from the generated spec (`npm run gen:api`); nothing here is hand-typed.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, send } from "./client";
import { qk } from "./hooks";
import type { S } from "./types";

export const fk = {
  waitlist: ["waitlist"] as const, vault: (kind?: string) => ["vault", kind ?? "all"] as const, vaultItem: (id: string) => ["vault-item", id] as const,
  sharing: ["record-sharing"] as const, prescriptions: ["prescriptions"] as const, followUps: ["follow-ups"] as const,
  pharmacies: ["pharmacies"] as const, rxSearch: (q: string, ph?: string) => ["rx-search", q, ph] as const, cart: ["cart"] as const, pOrders: ["pharmacy-orders"] as const, pOrder: (id: string) => ["pharmacy-order", id] as const,
  labTests: (q: string) => ["lab-tests", q] as const, labSlots: (labId: string, ct: string, tests: string) => ["lab-slots", labId, ct, tests] as const, labBookings: ["lab-bookings"] as const, labBooking: (id: string) => ["lab-booking", id] as const,
  teleProviders: (q: string) => ["tele-providers", q] as const, teleSessions: ["tele-sessions"] as const, teleVisits: ["tele-visits"] as const, teleSession: (id: string) => ["tele-session", id] as const,
  markets: ["markets"] as const,
};

// ---- markets (launch gate) ----
export const useMarkets = () => useQuery({ queryKey: fk.markets, staleTime: 300_000, retry: 0, queryFn: () => send(api.GET("/api/v1/markets", { params: { query: { all: "true" } } })) });

// ---- waitlist (KXM-BK-12) ----
export const useWaitlist = (enabled = true) => useQuery({ queryKey: fk.waitlist, enabled, refetchInterval: 30_000, queryFn: () => send(api.GET("/api/v1/waitlist")) });
export const useJoinWaitlist = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: S["JoinWaitlistBody"]) => send(api.POST("/api/v1/waitlist", { body: b })), onSuccess: () => qc.invalidateQueries({ queryKey: fk.waitlist }) });
};
export const useLeaveWaitlist = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => send(api.DELETE("/api/v1/waitlist/{id}", { params: { path: { id } } })), onSuccess: () => qc.invalidateQueries({ queryKey: fk.waitlist }) });
};
/** Accept → the normal 5-minute hold; the caller routes to /checkout/{booking.id}. 409 SLOT_TAKEN / 410 OFFER_EXPIRED surface as ApiError. */
export const useAcceptOffer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (offerId: string) => send(api.POST("/api/v1/waitlist/offers/{id}/accept", { params: { path: { id: offerId } } })),
    onSuccess: (b) => { qc.setQueryData(qk.booking(b.id), b); void qc.invalidateQueries({ queryKey: fk.waitlist }); void qc.invalidateQueries({ queryKey: qk.bookings }); },
  });
};
export const useDeclineOffer = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (offerId: string) => send(api.POST("/api/v1/waitlist/offers/{id}/decline", { params: { path: { id: offerId } } })), onSuccess: () => qc.invalidateQueries({ queryKey: fk.waitlist }) });
};

// ---- records vault (KXM-RC-01..03) ----
export const useVault = (kind?: S["VaultItemDto"]["kind"], enabled = true) =>
  useQuery({ queryKey: fk.vault(kind), enabled, queryFn: () => send(api.GET("/api/v1/me/vault", { params: { query: (kind ? { kind } : {}) as { kind: string } } })) });
export const useVaultItem = (id: string) => useQuery({ queryKey: fk.vaultItem(id), enabled: !!id, queryFn: () => send(api.GET("/api/v1/me/vault/{id}", { params: { path: { id } } })) });
export const useDeleteRecord = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => send(api.DELETE("/api/v1/me/vault/{id}", { params: { path: { id } } })), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["vault"] }); void qc.invalidateQueries({ queryKey: fk.prescriptions }); } });
};
export const useUploadRecord = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: S["UploadBody"]) => send(api.POST("/api/v1/me/vault/uploads", { body: b })), onSuccess: () => qc.invalidateQueries({ queryKey: ["vault"] }) });
};
export const useRecordSharing = (enabled = true) => useQuery({ queryKey: fk.sharing, enabled, queryFn: () => send(api.GET("/api/v1/me/record-sharing")) });
export const useSetRecordSharing = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { scope: S["RecordShareScopeDto"]["scope"]; granted: boolean }) => send(api.PUT("/api/v1/me/record-sharing/{scope}", { params: { path: { scope: v.scope } }, body: { granted: v.granted } })),
    onSuccess: (d) => { qc.setQueryData(fk.sharing, d); void qc.invalidateQueries({ queryKey: ["vault"] }); },
  });
};
export const usePrescriptions = (enabled = true) => useQuery({ queryKey: fk.prescriptions, enabled, queryFn: () => send(api.GET("/api/v1/me/prescriptions")) });
export const useFollowUps = (enabled = true) => useQuery({ queryKey: fk.followUps, enabled, queryFn: () => send(api.GET("/api/v1/me/follow-ups")) });
export const useAddFollowUp = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: S["FollowUpCreateBody"]) => send(api.POST("/api/v1/me/follow-ups", { body: b })), onSuccess: () => qc.invalidateQueries({ queryKey: fk.followUps }) });
};
export const useRemoveFollowUp = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => send(api.DELETE("/api/v1/me/follow-ups/{id}", { params: { path: { id } } })), onSuccess: () => qc.invalidateQueries({ queryKey: fk.followUps }) });
};

// ---- pharmacy ----
export const usePharmacies = () => useQuery({ queryKey: fk.pharmacies, queryFn: () => send(api.GET("/api/v1/pharmacy/pharmacies")) });
export const useMedicineSearch = (q: string, pharmacyId?: string) =>
  useQuery({ queryKey: fk.rxSearch(q, pharmacyId), enabled: q.trim().length >= 2, queryFn: () => send(api.GET("/api/v1/pharmacy/search", { params: { query: { q: q.trim(), ...(pharmacyId ? { pharmacyId } : {}) } as { q: string; pharmacyId: string } } })) });
export const useCart = (enabled = true) => useQuery({ queryKey: fk.cart, enabled, queryFn: () => send(api.GET("/api/v1/pharmacy/cart")) });
export const useSetCart = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: S["CartBody"]) => send(api.PUT("/api/v1/pharmacy/cart", { body: b })), onSuccess: (d) => qc.setQueryData(fk.cart, d) });
};
export const useClearCart = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => send(api.DELETE("/api/v1/pharmacy/cart")), onSuccess: () => qc.invalidateQueries({ queryKey: fk.cart }) });
};
export const useSetDelivery = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: S["DeliveryBody"]) => send(api.PUT("/api/v1/pharmacy/cart/delivery", { body: b })), onSuccess: (d) => qc.setQueryData(fk.cart, d) });
};
export const usePlaceOrder = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: S["CreateOrderBody"]) => send(api.POST("/api/v1/pharmacy/orders", { body: b })), onSuccess: () => { void qc.invalidateQueries({ queryKey: fk.cart }); void qc.invalidateQueries({ queryKey: fk.pOrders }); } });
};
export const usePharmacyOrders = (enabled = true) => useQuery({ queryKey: fk.pOrders, enabled, queryFn: () => send(api.GET("/api/v1/pharmacy/orders")) });
export const usePharmacyOrder = (id: string) =>
  useQuery({ queryKey: fk.pOrder(id), enabled: !!id, refetchInterval: (q) => (["PENDING_PAYMENT", "PAID", "SUBMITTED"].includes(q.state.data?.status ?? "") ? 5_000 : false), queryFn: () => send(api.GET("/api/v1/pharmacy/orders/{id}", { params: { path: { id } } })) });
export const useCancelPharmacyOrder = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => send(api.POST("/api/v1/pharmacy/orders/{id}/cancel", { params: { path: { id } } })), onSuccess: (o) => { qc.setQueryData(fk.pOrder(o.id), o); void qc.invalidateQueries({ queryKey: fk.pOrders }); } });
};

// ---- lab ----
export const useLabTests = (q: string, enabled = true) => useQuery({ queryKey: fk.labTests(q), enabled, queryFn: () => send(api.GET("/api/v1/lab/tests", { params: { query: (q.trim() ? { q: q.trim() } : {}) as { q: string; labId: string } } })) });
export const useLabSlots = (labId: string | undefined, collectionType: "HOME" | "WALK_IN", tests: string[]) => {
  const key = tests.join(",");
  return useQuery({
    queryKey: fk.labSlots(labId ?? "", collectionType, key), enabled: !!labId && tests.length > 0,
    queryFn: () => { const from = new Date(); const to = new Date(from.getTime() + 7 * 86_400_000); return send(api.GET("/api/v1/lab/slots", { params: { query: { labId: labId!, collectionType, from: from.toISOString(), to: to.toISOString(), tests: key } } })); },
  });
};
export const useBookLab = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: S["LabBookBody"]) => send(api.POST("/api/v1/lab/bookings", { body: b })), onSuccess: () => qc.invalidateQueries({ queryKey: fk.labBookings }) });
};
export const useLabBookings = (enabled = true) => useQuery({ queryKey: fk.labBookings, enabled, queryFn: () => send(api.GET("/api/v1/lab/bookings")) });
export const useLabBooking = (id: string) =>
  useQuery({ queryKey: fk.labBooking(id), enabled: !!id, refetchInterval: (q) => (["PENDING_PAYMENT", "PAID", "SUBMITTED"].includes(q.state.data?.status ?? "") ? 5_000 : false), queryFn: () => send(api.GET("/api/v1/lab/bookings/{id}", { params: { path: { id } } })) });
export const useCancelLabBooking = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => send(api.POST("/api/v1/lab/bookings/{id}/cancel", { params: { path: { id } } })), onSuccess: (b) => { qc.setQueryData(fk.labBooking(b.id), b); void qc.invalidateQueries({ queryKey: fk.labBookings }); } });
};

// ---- telemedicine (MOCK video provider) ----
export const useTeleProviders = (q: string, enabled = true) => useQuery({ queryKey: fk.teleProviders(q), enabled, queryFn: () => send(api.GET("/api/v1/telemedicine/providers", { params: { query: (q.trim() ? { q: q.trim() } : {}) as { q: string; specialty: string } } })) });
/** Clinic-owned video visits (bookings that carry a telehealth block): session state, join window and the patient join URL. */
export const useTeleVisits = (enabled = true) => useQuery({ queryKey: fk.teleVisits, enabled, refetchInterval: 30_000, queryFn: () => send(api.GET("/api/v1/telemedicine/visits")) });
export const useTeleSessions = (enabled = true) => useQuery({ queryKey: fk.teleSessions, enabled, queryFn: () => send(api.GET("/api/v1/telemedicine/sessions")) });
export const useTeleSession = (id: string) => useQuery({ queryKey: fk.teleSession(id), enabled: !!id, refetchInterval: 10_000, queryFn: () => send(api.GET("/api/v1/telemedicine/sessions/{id}", { params: { path: { id } } })) });
export const useCreateTeleSession = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (bookingId: string) => send(api.POST("/api/v1/telemedicine/sessions", { body: { bookingId } })), onSuccess: () => qc.invalidateQueries({ queryKey: fk.teleSessions }) });
};
export const useJoinTele = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => send(api.POST("/api/v1/telemedicine/sessions/{id}/join", { params: { path: { id } } })), onSuccess: (r) => qc.setQueryData(fk.teleSession(r.session.id), r.session) });
};
export const useEndTele = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => send(api.POST("/api/v1/telemedicine/sessions/{id}/end", { params: { path: { id } } })), onSuccess: (s) => { qc.setQueryData(fk.teleSession(s.id), s); void qc.invalidateQueries({ queryKey: fk.teleSessions }); } });
};
