// Console hooks for messaging, fee statements, vertical order monitors and the waitlist scan — typed from the generated contract.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./client";
import type { components } from "./schema";
import type { LabBooking, PharmacyOrder } from "./types";

type S = components["schemas"];
export type MessageState = S["SimulateBody"]["state"];

export const useMessagingStats = () => useQuery({ queryKey: ["ops", "msg-stats"], refetchInterval: 10_000, queryFn: () => unwrap(api.GET("/api/v1/admin/messaging/stats")) });
export const useMessageLog = (f: { channel: string; status: string; direction: string }) =>
  useQuery({
    queryKey: ["ops", "msg-log", f], refetchInterval: 10_000,
    queryFn: () => unwrap(api.GET("/api/v1/admin/messaging/log", { params: { query: { limit: "100", ...(f.channel ? { channel: f.channel } : {}), ...(f.status ? { status: f.status } : {}), ...(f.direction ? { direction: f.direction } : {}) } } })),
  });
const useInvalidateMessaging = () => { const qc = useQueryClient(); return () => { void qc.invalidateQueries({ queryKey: ["ops", "msg-log"] }); void qc.invalidateQueries({ queryKey: ["ops", "msg-stats"] }); }; };
export const useSimulateDelivery = () => {
  const inv = useInvalidateMessaging();
  return useMutation({ mutationFn: (v: { id: string; state: MessageState }) => unwrap(api.POST("/api/v1/admin/messaging/log/{id}/simulate", { params: { path: { id: v.id } }, body: { state: v.state } })), onSuccess: inv });
};
export const useDeliveryTick = () => {
  const inv = useInvalidateMessaging();
  return useMutation({ mutationFn: () => unwrap(api.POST("/api/v1/admin/messaging/delivery-tick")), onSuccess: inv });
};

export const useFeeStatement = (from: string, to: string) =>
  useQuery({ queryKey: ["ops", "fees", from, to], queryFn: () => unwrap(api.GET("/api/v1/admin/fee-statements", { params: { query: { ...(from ? { from } : {}), ...(to ? { to } : {}) } } })) });

// Admin order lists add sub / platformFeeMinor / takeRateBps to the public order DTOs (documented inline in the contract as allOf).
const asOrders = <T,>(p: Promise<{ data?: unknown; error?: unknown; response: Response }>) => unwrap(p as Promise<{ data?: T[]; error?: unknown; response: Response }>);
export const usePharmacyOrderMonitor = (status: string) =>
  useQuery({ queryKey: ["ops", "pharmacy-orders", status], refetchInterval: 15_000, queryFn: () => asOrders<PharmacyOrder>(api.GET("/api/v1/admin/pharmacy/orders", { params: { query: status ? { status } : {} } })) });
export const useLabBookingMonitor = (status: string) =>
  useQuery({ queryKey: ["ops", "lab-bookings", status], refetchInterval: 15_000, queryFn: () => asOrders<LabBooking>(api.GET("/api/v1/admin/lab/bookings", { params: { query: status ? { status } : {} } })) });
export const useResubmitPharmacy = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => unwrap(api.POST("/api/v1/admin/pharmacy/orders/{id}/resubmit", { params: { path: { id } } })), onSuccess: () => qc.invalidateQueries({ queryKey: ["ops", "pharmacy-orders"] }) });
};
/** PARTIAL_REVIEW: settle with the market/org partial-fulfilment policy (pro-rata refund of the undispensed lines). */
export const useResolvePartial = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => unwrap(api.POST("/api/v1/admin/pharmacy/orders/{id}/resolve-partial", { params: { path: { id } }, body: {} })), onSuccess: () => qc.invalidateQueries({ queryKey: ["ops", "pharmacy-orders"] }) });
};
export const useResubmitLab = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => unwrap(api.POST("/api/v1/admin/lab/bookings/{id}/resubmit", { params: { path: { id } } })), onSuccess: () => qc.invalidateQueries({ queryKey: ["ops", "lab-bookings"] }) });
};

export const useWaitlistScan = () => useMutation({ mutationFn: () => unwrap(api.POST("/api/v1/admin/waitlist/scan")) });
