// GRW-P2-E: typed hooks over /api/v1/admin/growth/lifecycle. Aggregates only; nothing here shows a patient.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";

const B = "/admin/growth/lifecycle";
const qs = (o: Record<string, string | number | undefined | null>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v)); const s = p.toString(); return s ? `?${s}` : ""; };

export type MessageClass = "TRANSACTIONAL" | "SECURITY" | "CLINICAL" | "MARKETING";
export interface JourneyStepRow { step: number; messageClass: MessageClass; channels: string[]; kind: string; delayMinutes: number }
export interface JourneyRow { key: string; trigger: string; anchored: boolean; describe: { en: string; ar: string }; enabled: boolean; activeEnrolments: number; hasMarketingStep: boolean; steps: JourneyStepRow[] }
export interface LifecycleOverview {
  market: string; flags: { lifecycleJourneys: boolean; marketingMessaging: boolean };
  policy: { version: number; source: "ACTIVE" | "PROPOSED_DEFAULT"; caps: { perDay: number; perWeek: number }; quietHours: { start: string; end: string; timezone: string }; holdoutBps: number };
  journeys: JourneyRow[];
}
export interface FunnelRow { stage: string; count: number | null }
export interface DecisionRow { journeyKey: string; messageClass: MessageClass; decision: "SEND" | "SKIP"; reason: string; count: number }
export interface TemplateRow { kind: string; messageClass: MessageClass; purpose: string; promotional: boolean; copyReview: string; templateId: string; en: string; ar: string }
export interface SuppressionRow { id: string; market: string; channel: string; reason: string; source: string; createdAt: string; liftedAt: string | null; hashTail: string }

export const useLifecycle = (market: string) => useQuery({ queryKey: ["growth", "lifecycle", market], queryFn: () => rawApi<LifecycleOverview>("GET", `${B}${qs({ market })}`) });
export const useLifecycleFunnel = (market: string) => useQuery({ queryKey: ["growth", "lifecycle", "funnel", market], queryFn: () => rawApi<FunnelRow[]>("GET", `${B}/funnel${qs({ market })}`) });
export const useLifecycleDecisions = (market: string, days: number) => useQuery({ queryKey: ["growth", "lifecycle", "decisions", market, days], queryFn: () => rawApi<DecisionRow[]>("GET", `${B}/decisions${qs({ market, days })}`) });
export const useLifecycleTemplates = () => useQuery({ queryKey: ["growth", "lifecycle", "templates"], queryFn: () => rawApi<TemplateRow[]>("GET", `${B}/templates`) });
export const useSuppressions = (active = true) => useQuery({ queryKey: ["growth", "lifecycle", "suppressions", active], queryFn: () => rawApi<SuppressionRow[]>("GET", `${B}/suppressions${qs({ active: active ? "1" : "0" })}`) });
export function useSuppressionActions() {
  const qc = useQueryClient(); const done = () => void qc.invalidateQueries({ queryKey: ["growth", "lifecycle", "suppressions"] });
  return {
    add: useMutation({ mutationFn: (v: { address: string; channel: string; note: string }) => rawApi("POST", `${B}/suppressions`, v), onSuccess: done }),
    requestLift: useMutation({ mutationFn: (v: { id: string; evidence: string }) => rawApi("POST", `${B}/suppressions/${v.id}/lift-request`, { evidence: v.evidence }), onSuccess: done }),
    approveLift: useMutation({ mutationFn: (id: string) => rawApi("POST", `${B}/suppressions/${id}/lift-approve`), onSuccess: done }),
  };
}
