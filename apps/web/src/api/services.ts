// Hooks for the Phase 2/3 features, typed straight from the generated OpenAPI contract (./schema.d.ts) — no hand-typed responses.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, authedBlob, unwrap } from "./client";
import type { components } from "./schema";

type S = components["schemas"];
export type Market = S["MarketDto"];
export type VaultItem = S["VaultItemDto"];
export type VaultDetail = S["VaultDetailDto"];
export type RecordScope = S["RecordShareScopeDto"]["scope"];
export type FollowUp = S["FollowUpDto"];
export type WaitlistEntry = S["WaitlistEntryDto"];
export type WaitlistOffer = S["WaitlistOfferDto"];
export type Pharmacy = S["PharmacyDto"];
export type CatalogueItem = S["CatalogueItemDto"];
export type Cart = S["CartDto"];
export type PharmacyOrder = S["PharmacyOrderDto"];
export type LabTest = S["LabTestDto"];
export type LabSlot = S["LabSlotDto"];
export type LabBooking = S["LabBookingDto"];
export type TeleProvider = S["TeleProviderDto"];
export type TeleSession = S["TeleSessionDto"];
export type DeliveryInput = S["DeliveryBody"];
export type LabBookInput = S["LabBookBody"];
export type ClientEvent = S["ClientEventBody"];

export const sk = {
  markets: ["markets"] as const, vault: (k?: string) => ["vault", k ?? "all"] as const, vaultItem: (id: string) => ["vault", "item", id] as const, sharing: ["record-sharing"] as const,
  rx: ["prescriptions"] as const, followUps: ["follow-ups"] as const, waitlist: ["waitlist"] as const,
  pharmacies: ["pharmacy", "pharmacies"] as const, medicines: (q: string, p?: string) => ["pharmacy", "search", q, p ?? ""] as const, cart: ["pharmacy", "cart"] as const,
  orders: ["pharmacy", "orders"] as const, order: (id: string) => ["pharmacy", "order", id] as const,
  labTests: (q: string, l?: string) => ["lab", "tests", q, l ?? ""] as const, labSlots: (l: string, c: string, f?: string, t?: string, tests?: string) => ["lab", "slots", l, c, f, t, tests] as const,
  labBookings: ["lab", "bookings"] as const, labBooking: (id: string) => ["lab", "booking", id] as const,
  teleProviders: (s: string, q: string) => ["tele", "providers", s, q] as const, teleSessions: ["tele", "sessions"] as const, teleSession: (id: string) => ["tele", "session", id] as const,
  sponsored: ["sponsored"] as const,
};

// ───── markets (market.<cc>.live) ─────
export const useMarkets = () => useQuery({ queryKey: sk.markets, staleTime: 300_000, queryFn: () => unwrap(api.GET("/api/v1/markets", { params: { query: { all: "true" } } })) });

// ───── sponsored label (P3; the API returns no items until commercial terms exist) ─────
export const useSponsored = (enabled = true) => useQuery({ queryKey: sk.sponsored, enabled, retry: 0, staleTime: 300_000, queryFn: () => unwrap(api.GET("/api/v1/search/sponsored")) });

// ───── waitlist (BK-12) ─────
export const useWaitlist = (enabled = true) => useQuery({ queryKey: sk.waitlist, enabled, refetchInterval: 30_000, queryFn: () => unwrap(api.GET("/api/v1/waitlist")) });
export const useJoinWaitlist = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: S["JoinWaitlistBody"]) => unwrap(api.POST("/api/v1/waitlist", { body })), onSuccess: () => qc.invalidateQueries({ queryKey: sk.waitlist }) });
};
export const useCancelWaitlist = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => unwrap(api.DELETE("/api/v1/waitlist/{id}", { params: { path: { id } } })), onSuccess: () => qc.invalidateQueries({ queryKey: sk.waitlist }) });
};
/** Accept → the normal 5-minute hold; the returned booking continues at /checkout/:id. */
export const useAcceptOffer = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => unwrap(api.POST("/api/v1/waitlist/offers/{id}/accept", { params: { path: { id } } })), onSettled: () => qc.invalidateQueries({ queryKey: sk.waitlist }) });
};
export const useDeclineOffer = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => unwrap(api.POST("/api/v1/waitlist/offers/{id}/decline", { params: { path: { id } } })), onSuccess: () => qc.invalidateQueries({ queryKey: sk.waitlist }) });
};

// ───── records vault (RC-01..03) ─────
export const useVault = (kind?: VaultItem["kind"]) => useQuery({ queryKey: sk.vault(kind), queryFn: () => unwrap(api.GET("/api/v1/me/vault", { params: { query: kind ? { kind } : {} } })) });
export const useVaultItem = (id: string) => useQuery({ queryKey: sk.vaultItem(id), enabled: !!id, queryFn: () => unwrap(api.GET("/api/v1/me/vault/{id}", { params: { path: { id } } })) });
const useInvalidateVault = () => { const qc = useQueryClient(); return () => { void qc.invalidateQueries({ queryKey: ["vault"] }); void qc.invalidateQueries({ queryKey: sk.rx }); }; };
export const useDeleteVaultItem = () => { const inv = useInvalidateVault(); return useMutation({ mutationFn: (id: string) => unwrap(api.DELETE("/api/v1/me/vault/{id}", { params: { path: { id } } })), onSuccess: inv }); };

export const fileToBase64 = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1] ?? "");
  r.onerror = () => rej(r.error);
  r.readAsDataURL(f);
});
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const UPLOAD_TYPES = ["application/pdf", "image/jpeg", "image/png"];
export const useUploadRecord = () => {
  const inv = useInvalidateVault();
  return useMutation({
    mutationFn: async (v: { file: File; title?: string }) =>
      unwrap(api.POST("/api/v1/me/vault/uploads", { body: { fileName: v.file.name, mimeType: v.file.type, contentBase64: await fileToBase64(v.file), ...(v.title ? { title: v.title } : {}) } })),
    onSuccess: inv,
  });
};
export const downloadVaultFile = (id: string) => authedBlob(`/api/v1/me/vault/${id}/content`);

export const useRecordSharing = () => useQuery({ queryKey: sk.sharing, queryFn: () => unwrap(api.GET("/api/v1/me/record-sharing")) });
export const useSetRecordSharing = () => {
  const qc = useQueryClient();
  const inv = useInvalidateVault();
  return useMutation({
    mutationFn: (v: { scope: RecordScope; granted: boolean }) => unwrap(api.PUT("/api/v1/me/record-sharing/{scope}", { params: { path: { scope: v.scope } }, body: { granted: v.granted } })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: sk.sharing }); inv(); },
  });
};
export const usePrescriptions = () => useQuery({ queryKey: sk.rx, queryFn: () => unwrap(api.GET("/api/v1/me/prescriptions")) });
export const useFollowUps = () => useQuery({ queryKey: sk.followUps, queryFn: () => unwrap(api.GET("/api/v1/me/follow-ups")) });
export const useCreateFollowUp = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: S["FollowUpCreateBody"]) => unwrap(api.POST("/api/v1/me/follow-ups", { body })), onSuccess: () => qc.invalidateQueries({ queryKey: sk.followUps }) });
};
export const useCancelFollowUp = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => unwrap(api.DELETE("/api/v1/me/follow-ups/{id}", { params: { path: { id } } })), onSuccess: () => qc.invalidateQueries({ queryKey: sk.followUps }) });
};

// ───── pharmacy ─────
export const usePharmacies = () => useQuery({ queryKey: sk.pharmacies, retry: 0, queryFn: () => unwrap(api.GET("/api/v1/pharmacy/pharmacies")) });
export const useMedicineSearch = (q: string, pharmacyId?: string) =>
  useQuery({ queryKey: sk.medicines(q, pharmacyId), enabled: q.trim().length >= 2, retry: 0, queryFn: () => unwrap(api.GET("/api/v1/pharmacy/search", { params: { query: { q, ...(pharmacyId ? { pharmacyId } : {}) } } })) });
export const useCart = () => useQuery({ queryKey: sk.cart, retry: 0, queryFn: () => unwrap(api.GET("/api/v1/pharmacy/cart")) });
const useCartMutation = <V,>(fn: (v: V) => Promise<Cart | unknown>) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: (c) => { if (c && typeof c === "object" && "items" in c) qc.setQueryData(sk.cart, c); else void qc.invalidateQueries({ queryKey: sk.cart }); } });
};
export const usePutCart = () => useCartMutation((body: S["CartBody"]) => unwrap(api.PUT("/api/v1/pharmacy/cart", { body })));
export const useClearCart = () => useCartMutation(() => unwrap(api.DELETE("/api/v1/pharmacy/cart")));
export const usePutDelivery = () => useCartMutation((body: DeliveryInput) => unwrap(api.PUT("/api/v1/pharmacy/cart/delivery", { body: body })));
export const useCreateOrder = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: S["CreateOrderBody"]) => unwrap(api.POST("/api/v1/pharmacy/orders", { body })), onSuccess: () => { void qc.invalidateQueries({ queryKey: sk.cart }); void qc.invalidateQueries({ queryKey: sk.orders }); } });
};
export const usePharmacyOrders = () => useQuery({ queryKey: sk.orders, queryFn: () => unwrap(api.GET("/api/v1/pharmacy/orders")) });
const LIVE_ORDER = ["PENDING_PAYMENT", "PAID", "SUBMITTED", "READY"];
export const usePharmacyOrder = (id: string) =>
  useQuery({ queryKey: sk.order(id), enabled: !!id, refetchInterval: (q) => (LIVE_ORDER.includes(q.state.data?.status ?? "") ? 4_000 : false), queryFn: () => unwrap(api.GET("/api/v1/pharmacy/orders/{id}", { params: { path: { id } } })) });
export const useCancelPharmacyOrder = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => unwrap(api.POST("/api/v1/pharmacy/orders/{id}/cancel", { params: { path: { id } } })), onSuccess: (o) => { qc.setQueryData(sk.order(o.id), o); void qc.invalidateQueries({ queryKey: sk.orders }); } });
};

// ───── lab ─────
export const useLabTests = (q: string) => useQuery({ queryKey: sk.labTests(q), retry: 0, queryFn: () => unwrap(api.GET("/api/v1/lab/tests", { params: { query: q ? { q } : {} } })) });
export const useLabSlots = (a: { labId?: string; collectionType: "HOME" | "WALK_IN"; tests: string[]; from?: string; to?: string }) =>
  useQuery({
    queryKey: sk.labSlots(a.labId ?? "", a.collectionType, a.from, a.to, a.tests.join(",")), enabled: !!a.labId && a.tests.length > 0, retry: 0,
    queryFn: () => unwrap(api.GET("/api/v1/lab/slots", { params: { query: { labId: a.labId!, collectionType: a.collectionType, tests: a.tests.join(","), ...(a.from ? { from: a.from } : {}), ...(a.to ? { to: a.to } : {}) } } })),
  });
export const useBookLab = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: LabBookInput) => unwrap(api.POST("/api/v1/lab/bookings", { body })), onSuccess: () => qc.invalidateQueries({ queryKey: sk.labBookings }) });
};
export const useLabBookings = () => useQuery({ queryKey: sk.labBookings, queryFn: () => unwrap(api.GET("/api/v1/lab/bookings")) });
export const useLabBooking = (id: string) =>
  useQuery({ queryKey: sk.labBooking(id), enabled: !!id, refetchInterval: (q) => (["PENDING_PAYMENT", "PAID", "SUBMITTED"].includes(q.state.data?.status ?? "") ? 5_000 : false), queryFn: () => unwrap(api.GET("/api/v1/lab/bookings/{id}", { params: { path: { id } } })) });
export const useCancelLab = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => unwrap(api.POST("/api/v1/lab/bookings/{id}/cancel", { params: { path: { id } } })), onSuccess: (b) => { qc.setQueryData(sk.labBooking(b.id), b); void qc.invalidateQueries({ queryKey: sk.labBookings }); } });
};

// ───── telemedicine ─────
export const useTeleProviders = (specialty: string, q: string) => useQuery({ queryKey: sk.teleProviders(specialty, q), retry: 0, queryFn: () => unwrap(api.GET("/api/v1/telemedicine/providers", { params: { query: { ...(specialty ? { specialty } : {}), ...(q ? { q } : {}) } } })) });
export const useTeleSessions = () => useQuery({ queryKey: sk.teleSessions, queryFn: () => unwrap(api.GET("/api/v1/telemedicine/sessions")) });
export const useTeleSession = (id: string) => useQuery({ queryKey: sk.teleSession(id), enabled: !!id, refetchInterval: 15_000, queryFn: () => unwrap(api.GET("/api/v1/telemedicine/sessions/{id}", { params: { path: { id } } })) });
export const useCreateTeleSession = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (bookingId: string) => unwrap(api.POST("/api/v1/telemedicine/sessions", { body: { bookingId } })), onSuccess: () => qc.invalidateQueries({ queryKey: sk.teleSessions }) });
};
export const useJoinTeleSession = () => useMutation({ mutationFn: (id: string) => unwrap(api.POST("/api/v1/telemedicine/sessions/{id}/join", { params: { path: { id } } })) });
export const useEndTeleSession = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => unwrap(api.POST("/api/v1/telemedicine/sessions/{id}/end", { params: { path: { id } } })), onSuccess: (s) => { qc.setQueryData(sk.teleSession(s.id), s); void qc.invalidateQueries({ queryKey: sk.teleSessions }); } });
};

// ───── analytics sink (POST /analytics/events; whitelisted names + props enforced by lib/analytics) ─────
export const postAnalytics = (events: ClientEvent[]) => unwrap(api.POST("/api/v1/analytics/events", { body: { events } }));
