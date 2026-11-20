// Rev 2.3 home-visit ops hooks (KXMOP12 safety console, KXMPAY07 held deposits, KXMOP06 gate metric): typed from the generated contract.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./client";
import type { components } from "./schema";

type S = components["schemas"];
export type SafetyAlert = S["SafetyAlertDto"];
export type SafetySummary = S["SafetySummaryDto"];
export type HeldDeposit = S["HeldDepositDto"];
export type HomeGateMetric = S["HomeGateMetricDto"];
export type GateBoard = S["GateBoardDto"];
export type AlertStatus = SafetyAlert["status"];

const sk = { alerts: (s: string) => ["safety", "alerts", s] as const, summary: ["safety", "summary"] as const, held: ["payments", "held"] as const, metric: ["home", "gate-metric"] as const, gates: ["flags", "gates"] as const, unsafe: ["safety", "unsafe"] as const };

// 5 s refresh: the 60 s delivery SLO is only meaningful on a live feed.
export const useSafetyAlerts = (status: string) => useQuery({ queryKey: sk.alerts(status), refetchInterval: 5_000, queryFn: () => unwrap(api.GET("/api/v1/admin/safety/alerts", { params: { query: { limit: "100", ...(status ? { status } : {}) } } })) });
export const useSafetySummary = () => useQuery({ queryKey: sk.summary, refetchInterval: 10_000, queryFn: () => unwrap(api.GET("/api/v1/admin/safety/summary")) });
export const useUnsafeAborts = () => useQuery({ queryKey: sk.unsafe, refetchInterval: 15_000, queryFn: () => unwrap(api.GET("/api/v1/admin/safety/unsafe-aborts")) });
const useInvSafety = () => { const qc = useQueryClient(); return () => { void qc.invalidateQueries({ queryKey: ["safety"] }); void qc.invalidateQueries({ queryKey: sk.held }); }; };
export type AlertAction = "acknowledge" | "escalate" | "resolve";
export const useAlertAction = () => {
  const inv = useInvSafety();
  return useMutation({
    mutationFn: (v: { id: string; action: AlertAction; note?: string }) => {
      const params = { path: { id: v.id } }; const body = v.note ? { note: v.note } : {};
      return unwrap(v.action === "acknowledge" ? api.POST("/api/v1/admin/safety/alerts/{id}/acknowledge", { params, body }) : v.action === "escalate" ? api.POST("/api/v1/admin/safety/alerts/{id}/escalate", { params, body }) : api.POST("/api/v1/admin/safety/alerts/{id}/resolve", { params, body }));
    },
    onSuccess: inv,
  });
};
export const useSafetySweep = () => { const inv = useInvSafety(); return useMutation({ mutationFn: () => unwrap(api.POST("/api/v1/admin/safety/sweep")), onSuccess: inv }); };

export const useHeldDeposits = () => useQuery({ queryKey: sk.held, refetchInterval: 15_000, queryFn: () => unwrap(api.GET("/api/v1/admin/payments/held-for-review")) });
export const useReviewDeposit = () => {
  const inv = useInvSafety();
  return useMutation({
    mutationFn: (v: { paymentId: string; decision: "release" | "refund"; reason: string }) => {
      const params = { path: { paymentId: v.paymentId } }; const body = { reason: v.reason };
      return unwrap(v.decision === "release" ? api.POST("/api/v1/admin/payments/{paymentId}/review/release", { params, body }) : api.POST("/api/v1/admin/payments/{paymentId}/review/refund", { params, body }));
    },
    onSuccess: inv,
  });
};

export const useHomeGateMetric = () => useQuery({ queryKey: sk.metric, refetchInterval: 30_000, queryFn: () => unwrap(api.GET("/api/v1/admin/home-visits/gate-metric")) });
export const useGateBoard = () => useQuery({ queryKey: sk.gates, queryFn: () => unwrap(api.GET("/api/v1/admin/gates")) });
/** STOP action: only a human super admin records gate evidence (ADR-024). The console never calls this on its own. */
export const useRecordGateAll = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { gateId: string; body: S["GateAllBody"] }) => unwrap(api.PUT("/api/v1/admin/gates/{gateId}", { params: { path: { gateId: v.gateId } }, body: v.body })), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["flags"] }); void qc.invalidateQueries({ queryKey: sk.metric }); } });
};
