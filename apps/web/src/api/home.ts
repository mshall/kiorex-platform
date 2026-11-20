// Rev 2.3 home visits / nurse hooks, typed from the generated OpenAPI contract (./schema.d.ts). No mocks: every call hits the real API.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./client";
import type { components } from "./schema";
import { qk } from "./hooks";

type S = components["schemas"];
export type CareTypeInfo = S["CareTypeDto"];
export type HomeDistrict = S["HomeDistrictDto"];
export type Address = S["AddressDto"];
export type AddressInput = S["HomeAddressBody"];
export type FamilyShare = S["FamilyShareDto"];
export type FamilyShareCreated = S["FamilyShareCreatedDto"];
export type SafetyCard = S["SafetyCardDto"];
export type CarePlan = S["CarePlanDto"];
export type PublicVisitStatus = S["PublicVisitStatusDto"];
export type ProblemCategory = S["ProblemBody"]["category"];

export const hk = {
  careTypes: ["care-types"] as const, districts: ["home-districts"] as const, addresses: ["addresses"] as const,
  shares: (id: string) => ["family-shares", id] as const, card: (id: string) => ["safety-card", id] as const, plans: ["care-plans"] as const, status: (t: string) => ["visit-status", t] as const,
};

// KXMDS01: Doctors · Physiotherapy · Home nursing, each with its enabled state (flags kiorex.category.*).
export const useCareTypes = () => useQuery({ queryKey: hk.careTypes, staleTime: 60_000, retry: 0, queryFn: () => unwrap(api.GET("/api/v1/care-types")) });
// KXMHV02: districts with at least one home-enabled provider (district level only).
export const useHomeDistricts = (enabled = true) => useQuery({ queryKey: hk.districts, enabled, staleTime: 60_000, retry: 0, queryFn: () => unwrap(api.GET("/api/v1/home/districts")) });

// ───── address book (KXMHV01) ─────
export const useAddresses = (enabled = true) => useQuery({ queryKey: hk.addresses, enabled, queryFn: () => unwrap(api.GET("/api/v1/me/addresses")) });
const useInvAddr = () => { const qc = useQueryClient(); return () => void qc.invalidateQueries({ queryKey: hk.addresses }); };
export const useAddAddress = () => { const inv = useInvAddr(); return useMutation({ mutationFn: (body: AddressInput) => unwrap(api.POST("/api/v1/me/addresses", { body })), onSuccess: inv }); };
export const useUpdateAddress = () => { const inv = useInvAddr(); return useMutation({ mutationFn: (v: { id: string; body: Partial<AddressInput> }) => unwrap(api.PUT("/api/v1/me/addresses/{id}", { params: { path: { id: v.id } }, body: v.body })), onSuccess: inv }); };
export const useDeleteAddress = () => { const inv = useInvAddr(); return useMutation({ mutationFn: (id: string) => unwrap(api.DELETE("/api/v1/me/addresses/{id}", { params: { path: { id } } })), onSuccess: inv }); };
export const useConfirmAddress = () => { const inv = useInvAddr(); return useMutation({ mutationFn: (id: string) => unwrap(api.POST("/api/v1/me/addresses/{id}/confirm", { params: { path: { id } } })), onSuccess: inv }); };

// ───── booking extras (KXMHV07, KXMHV09) ─────
export const useFamilyShares = (bookingId: string, enabled = true) => useQuery({ queryKey: hk.shares(bookingId), enabled, retry: 0, queryFn: () => unwrap(api.GET("/api/v1/bookings/{id}/family-shares", { params: { path: { id: bookingId } } })) });
export const useCreateFamilyShare = (bookingId: string) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: S["FamilyShareBody"]) => unwrap(api.POST("/api/v1/bookings/{id}/family-shares", { params: { path: { id: bookingId } }, body })), onSuccess: () => qc.invalidateQueries({ queryKey: hk.shares(bookingId) }) });
};
export const useRevokeFamilyShare = (bookingId: string) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (shareId: string) => unwrap(api.DELETE("/api/v1/bookings/{id}/family-shares/{shareId}", { params: { path: { id: bookingId, shareId } } })), onSuccess: () => qc.invalidateQueries({ queryKey: hk.shares(bookingId) }) });
};
export const useSafetyCard = (bookingId: string, enabled = true) => useQuery({ queryKey: hk.card(bookingId), enabled, retry: 0, queryFn: () => unwrap(api.GET("/api/v1/bookings/{id}/safety-card", { params: { path: { id: bookingId } } })) });
export const useReportProblem = (bookingId: string) => useMutation({ mutationFn: (body: S["ProblemBody"]) => unwrap(api.POST("/api/v1/bookings/{id}/report-problem", { params: { path: { id: bookingId } }, body })) });

// ───── care plans (KXMHV08, P3 draft: 403 FEATURE_DISABLED until GKN1 + kiorex.home_visits) ─────
export const useCarePlans = () => useQuery({ queryKey: hk.plans, retry: 0, queryFn: () => unwrap(api.GET("/api/v1/care-plans")) });
export const useCreateCarePlan = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (body: S["CarePlanBody"]) => unwrap(api.POST("/api/v1/care-plans", { body })), onSuccess: () => qc.invalidateQueries({ queryKey: hk.plans }) }); };

// ───── public family link (no login) ─────
export const usePublicVisitStatus = (token: string) =>
  useQuery({ queryKey: hk.status(token), enabled: !!token, retry: 0, refetchInterval: 20_000, queryFn: () => unwrap(api.GET("/api/v1/public/visit-status/{token}", { params: { path: { token } } })) });
export const useStopVisitStatus = (token: string) => useMutation({ mutationFn: () => unwrap(api.POST("/api/v1/public/visit-status/{token}/stop", { params: { path: { token } } })) });

/** Home slots: the API answers 422 OUT_OF_COVERAGE when the district is not covered by the provider. */
export const useHomeSlots = (id: string, typeId: string | undefined, district: string | undefined, from?: string, to?: string) =>
  useQuery({
    queryKey: [...qk.slots(id, typeId ?? "", from, to), "HOME", district ?? ""], enabled: !!typeId && !!district, retry: 0, refetchInterval: 60_000,
    queryFn: async () => {
      const r = await unwrap(api.GET("/api/v1/providers/{id}/slots", { params: { path: { id }, query: { typeId: typeId!, serviceLocation: "HOME", district: district!, ...(from ? { from } : {}), ...(to ? { to } : {}) } } }));
      return (r.slots ?? []).map((s) => ({ slotId: s.startsAt, startsAt: s.startsAt, endsAt: s.endsAt, visitTypeId: typeId! }));
    },
  });
