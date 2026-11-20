// Rev 2.3 home-visit hooks (KXMDS01, KXMHV01-10) against the REAL Kiorex API. Types come from the generated spec.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, send } from "./client";
import { qk } from "./hooks";
import type { Address, AddressInput, S } from "./types";

export const hk = {
  careTypes: ["care-types"] as const, districts: ["home-districts"] as const, addresses: ["addresses"] as const,
  shares: (bookingId: string) => ["family-shares", bookingId] as const, safety: (bookingId: string) => ["safety-card", bookingId] as const, plans: ["care-plans"] as const,
};

/** Care-type categories with enabled state (flags kiorex.category.*). Disabled ones render as awaiting-gate, never hidden data. */
export const useCareTypes = () => useQuery({ queryKey: hk.careTypes, staleTime: 60_000, retry: 0, queryFn: () => send(api.GET("/api/v1/care-types", { params: { query: {} } })) });
/** Districts with at least one home-enabled provider (district level only, KXMHV02). */
export const useHomeDistricts = (enabled = true) => useQuery({ queryKey: hk.districts, enabled, staleTime: 300_000, queryFn: () => send(api.GET("/api/v1/home/districts")) });

// ---- address book (KXMHV01) ----
export const useAddresses = (enabled = true) => useQuery({ queryKey: hk.addresses, enabled, queryFn: () => send(api.GET("/api/v1/me/addresses")) });
const useAddrWrite = <V,>(fn: (v: V) => Promise<unknown>) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: hk.addresses }) });
};
export const useAddAddress = () => useAddrWrite((b: AddressInput) => send(api.POST("/api/v1/me/addresses", { body: b })));
export const useUpdateAddress = () => useAddrWrite((v: { id: string; body: Partial<AddressInput> }) => send(api.PUT("/api/v1/me/addresses/{id}", { params: { path: { id: v.id } }, body: v.body })));
export const useDeleteAddress = () => useAddrWrite((id: string) => send(api.DELETE("/api/v1/me/addresses/{id}", { params: { path: { id } } })));
/** Confirms the address with the OTP-verified phone (once, before the first home booking; an edit of district/street resets it). */
export const useConfirmAddress = () => useAddrWrite((id: string) => send(api.POST("/api/v1/me/addresses/{id}/confirm", { params: { path: { id } } })) as Promise<Address>);

// ---- family share (KXMHV07) ----
export const useFamilyShares = (bookingId: string, enabled = true) =>
  useQuery({ queryKey: hk.shares(bookingId), enabled: enabled && !!bookingId, queryFn: () => send(api.GET("/api/v1/bookings/{id}/family-shares", { params: { path: { id: bookingId } } })) });
export const useCreateFamilyShare = (bookingId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: S["FamilyShareBody"]) => send(api.POST("/api/v1/bookings/{id}/family-shares", { params: { path: { id: bookingId } }, body: b })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: hk.shares(bookingId) }); void qc.invalidateQueries({ queryKey: hk.safety(bookingId) }); void qc.invalidateQueries({ queryKey: qk.consents }); },
  });
};
export const useRevokeFamilyShare = (bookingId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) => send(api.DELETE("/api/v1/bookings/{id}/family-shares/{shareId}", { params: { path: { id: bookingId, shareId } } })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: hk.shares(bookingId) }); void qc.invalidateQueries({ queryKey: hk.safety(bookingId) }); },
  });
};

// ---- safety (KXMHV09) ----
export const useSafetyCard = (bookingId: string, enabled = true) =>
  useQuery({ queryKey: hk.safety(bookingId), enabled: enabled && !!bookingId, refetchInterval: 15_000, queryFn: () => send(api.GET("/api/v1/bookings/{id}/safety-card", { params: { path: { id: bookingId } } })) });
export const useReportProblem = (bookingId: string) =>
  useMutation({ mutationFn: (b: S["ProblemBody"]) => send(api.POST("/api/v1/bookings/{id}/report-problem", { params: { path: { id: bookingId } }, body: b })) });

// ---- care plans (KXMHV08, P3 draft) ----
export const useCarePlans = (enabled = true) => useQuery({ queryKey: hk.plans, enabled, retry: 0, queryFn: () => send(api.GET("/api/v1/care-plans")) });
export const useRequestCarePlan = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: S["CarePlanBody"]) => send(api.POST("/api/v1/care-plans", { body: b })), onSuccess: () => qc.invalidateQueries({ queryKey: hk.plans }) });
};
