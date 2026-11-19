import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./client";
import type { FlagAudit, FlagRequest, FlagRow, GateBody, Propagation, SetFlagBody, SetFlagResult } from "./types";
import { mapFinance, mapLiquidity, mapModeration, mapOutbox, mapProviders, mapTimeline } from "./adapters";

export type { FlagAudit, FlagRequest, FlagRow, GateBody, Propagation, SetFlagBody, SetFlagResult };

/** The contract declares request shapes only; cast responses to the view-models in ./types. */
const j = <T,>(p: Promise<{ data?: unknown; error?: unknown; response: Response }>) => unwrap(p as Promise<{ data?: T; error?: unknown; response: Response }>);
const Q = (x: object) => x as never; // contract marks every query param required; ours are optional
export const flagKeys = { all: ["flags"] as const, list: (market: string, product: string) => ["flags", "list", market, product] as const, requests: ["flags", "requests"] as const, audit: (k: string) => ["flags", "audit", k] as const, propagation: ["flags", "propagation"] as const };

export const useFlags = (market: string, product: string) =>
  useQuery({ queryKey: flagKeys.list(market, product), queryFn: () => j<FlagRow[]>(api.GET("/api/v1/admin/flags", { params: { query: Q({ market, ...(product ? { product } : {}) }) } })) });

export const useFlagRequests = () =>
  useQuery({ queryKey: flagKeys.requests, queryFn: () => j<FlagRequest[]>(api.GET("/api/v1/admin/flags/requests", { params: { query: Q({}) } })) });

export const useFlagAudit = (flagKey: string) =>
  useQuery({ queryKey: flagKeys.audit(flagKey), queryFn: () => j<FlagAudit[]>(api.GET("/api/v1/admin/flags/audit", { params: { query: Q(flagKey ? { flagKey } : {}) } })) });

export const usePropagation = () =>
  useQuery({ queryKey: flagKeys.propagation, refetchInterval: 15_000, queryFn: () => j<Propagation>(api.GET("/api/v1/admin/flags/propagation")) });

const useInvalidateFlags = () => { const qc = useQueryClient(); return () => qc.invalidateQueries({ queryKey: flagKeys.all }); };

export const useSetFlag = () => {
  const inv = useInvalidateFlags();
  return useMutation({
    mutationFn: (v: { key: string; body: SetFlagBody }) => j<SetFlagResult>(api.PUT("/api/v1/admin/flags/{key}/values", { params: { path: { key: v.key } }, body: v.body as never })),
    onSuccess: inv,
  });
};
export const useRecordGate = () => {
  const inv = useInvalidateFlags();
  return useMutation({ mutationFn: (v: { key: string; body: GateBody }) => unwrap(api.PUT("/api/v1/admin/flags/{key}/gate", { params: { path: { key: v.key } }, body: v.body as never })), onSuccess: inv });
};
export const useRevokeGate = () => {
  const inv = useInvalidateFlags();
  return useMutation({ mutationFn: (v: { key: string; reason: string }) => unwrap(api.POST("/api/v1/admin/flags/{key}/gate/revoke", { params: { path: { key: v.key } }, body: { reason: v.reason } as never })), onSuccess: inv });
};
export const useDecideRequest = () => {
  const inv = useInvalidateFlags();
  return useMutation({
    mutationFn: (v: { id: string; action: "approve" | "reject" | "review" }) =>
      v.action === "approve" ? unwrap(api.POST("/api/v1/admin/flags/requests/{id}/approve", { params: { path: { id: v.id } } }))
      : v.action === "reject" ? unwrap(api.POST("/api/v1/admin/flags/requests/{id}/reject", { params: { path: { id: v.id } } }))
      : unwrap(api.POST("/api/v1/admin/flags/requests/{id}/review", { params: { path: { id: v.id } } })),
    onSuccess: inv,
  });
};

/** CSV export (OP-11): server returns text/csv for ?format=csv. */
export async function downloadAuditCsv(token: string | null, flagKey?: string) {
  const qs = new URLSearchParams({ format: "csv", ...(flagKey ? { flagKey } : {}) });
  const r = await fetch(`/api/v1/admin/flags/audit?${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!r.ok) throw new Error(`export failed ${r.status}`);
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url; a.download = "flag-audit.csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- OP-01..06: real /admin/* endpoints mapped into console view-models ----
type A = Record<string, unknown>;
export const useProviders = (q: string, status: string) =>
  useQuery({ queryKey: ["ops", "providers", q, status], queryFn: async () => mapProviders(await j<A>(api.GET("/api/v1/admin/providers", { params: { query: Q({ ...(q ? { q } : {}), ...(status ? { status } : {}) }) } }))) });
export const useBookingTimeline = (id: string) =>
  useQuery({ queryKey: ["ops", "timeline", id], enabled: !!id, retry: false, queryFn: async () => mapTimeline(await j<A>(api.GET("/api/v1/admin/bookings/{id}/timeline", { params: { path: { id } } }))) });
export const useOutbox = (status: string) =>
  useQuery({ queryKey: ["ops", "outbox", status], refetchInterval: 10_000, queryFn: async () => mapOutbox(await j<A>(api.GET("/api/v1/admin/outbox", { params: { query: Q(status ? { status } : {}) } }))) });
export const useReplay = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => unwrap(api.POST("/api/v1/admin/outbox/{id}/replay", { params: { path: { id } } })), onSuccess: () => qc.invalidateQueries({ queryKey: ["ops", "outbox"] }) });
};
export const useFinance = () => useQuery({ queryKey: ["ops", "finance"], queryFn: async () => mapFinance(await j<A>(api.GET("/api/v1/admin/payments/dashboard"))) });
export const useModeration = () => useQuery({ queryKey: ["ops", "moderation"], queryFn: async () => mapModeration(await j<A[]>(api.GET("/api/v1/admin/moderation", { params: { query: Q({ status: "OPEN" }) } }))) });
export const useModerate = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: string; resolution: "RESTORED" | "KEPT_HIDDEN" }) => unwrap(api.POST("/api/v1/admin/moderation/{id}/resolve", { params: { path: { id: v.id } }, body: { resolution: v.resolution } as never })), onSuccess: () => qc.invalidateQueries({ queryKey: ["ops", "moderation"] }) });
};
export const useLiquidity = () => useQuery({ queryKey: ["ops", "liquidity"], queryFn: async () => mapLiquidity(await j<A>(api.GET("/api/v1/admin/liquidity", { params: { query: Q({}) } }))) });
