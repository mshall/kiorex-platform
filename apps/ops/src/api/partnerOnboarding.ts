import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";

export type StepState = "DONE" | "FAILED" | "WARN" | "PENDING" | "ACTION" | "LOCKED";
export interface PartnerStep { key: string; type: "AUTO" | "HUMAN"; state: StepState; code?: string; detail?: Record<string, unknown>; actor?: "ops_admin" | "super_admin"; link?: string }
export interface PartnerRow { id: string; kind: "CLINIC" | "NURSE" | "PHARMACY" | "LAB"; name: string; nameAr?: string | null; market: string; status: string; progress: number; humanActions: string[]; createdAt: string; updatedAt: string }
export interface PartnerDetail extends Omit<PartnerRow, "humanActions"> {
  orgRef: string; baseUrl?: string | null; clientKey?: string | null; decisionReason?: string | null; checksRunAt?: string | null; requestedBy?: string | null; approvedBy?: string | null; liveAt?: string | null;
  rotationPending: boolean; steps: PartnerStep[]; blockers: string[]; humanActions: string[]; readiness: Record<string, unknown>;
}
const B = "/admin/onboarding/partners";
const K = { list: ["pob", "list"] as const, one: (id: string) => ["pob", id] as const, audit: (id: string) => ["pob", id, "audit"] as const };

export const usePartnerConnections = () => useQuery({ queryKey: K.list, queryFn: () => rawApi<PartnerRow[]>("GET", B), refetchInterval: 15_000 });
export const usePartnerConnection = (id: string) => useQuery({ queryKey: K.one(id), queryFn: () => rawApi<PartnerDetail>("GET", `${B}/${id}`) });
export const usePartnerAudit = (id: string) => useQuery({ queryKey: K.audit(id), queryFn: () => rawApi<Array<{ id: string; actor: string; action: string; createdAt: string }>>("GET", `${B}/${id}/audit`) });

/** Every action returns the refreshed detail, which is written straight into the cache. */
export function usePartnerAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { path: string; body?: unknown }) => rawApi<PartnerDetail>("POST", `${B}/${id}/${v.path}`, v.body ?? {}),
    onSuccess: (d) => { qc.setQueryData(K.one(id), d); void qc.invalidateQueries({ queryKey: K.list }); void qc.invalidateQueries({ queryKey: K.audit(id) }); },
  });
}
