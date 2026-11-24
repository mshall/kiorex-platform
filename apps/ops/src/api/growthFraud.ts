// GRW-P3-D: ops hooks over /api/v1/admin/growth/fraud/* (the fraud v2 controllers). A field the server leaves out is rendered as a dash.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";

const B = "/admin/growth/fraud";
const qs = (o: Record<string, string | number | boolean | undefined | null>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, String(v)); const s = p.toString(); return s ? `?${s}` : ""; };

export type CaseBand = "LOW" | "MEDIUM" | "HIGH";
export interface CaseRow { id: string; kind: string; score: number; band: CaseBand; status: string; mode: "SHADOW" | "ENFORCE"; slaDueAt: string | null; breached: boolean; assignedTo: string | null; createdAt: string; subjectRef: string }
export interface CaseSummary { open: Array<{ kind: string; band: CaseBand; mode: string; count: number }>; breached: number }
export interface CaseEvidence {
  case: { id: string; kind: string; score: number; band: CaseBand; status: string; mode: string; slaDueAt: string | null; assignedTo: string | null; decision: { decision: string | null; reverse: boolean; suspendDays: number }; decisionNote: string | null; decidedBy: string | null; createdAt: string; decidedAt: string | null; subjectRef: string };
  signals: Array<{ ruleId: string; weight: number; evidenceRef: string | null; at: string }>;
  checks: Array<{ relationshipRef: string; key: string; passed: boolean; detail: unknown; at: string }>;
  log: Array<{ action: string; from: string | null; to: string; actor: string; note: string | null; at: string }>;
}
export interface RuleCfg { enabled: boolean; weight: number; cap: number; enforce: boolean }
export interface RulesView { ruleIds: string[]; editable: boolean; source: "PROPOSED_DEFAULT" | "ACTIVE"; config: { enforce: boolean; bands: { review: number; hold: number }; diminishing: number; reviewSlaHours: number; holdDays: number; suspendDays: number; appealWindowDays: number; banMaxDays: number; twoPersonOnMoney: boolean; rules: Record<string, RuleCfg>; actions: Record<string, Record<string, string>>; thresholds: Record<string, number>; version: number | null } }
export interface ShadowRule { ruleId: string; flagged: number; labelled: number; confirmed: number; dismissed: number; precision: number | null; pending: number; weight: number; enforce: boolean }
export interface ShadowReport { days: number; enforce: boolean; configVersion: number | null; wouldHaveBeenHeld: number; rules: ShadowRule[] }
export interface FairnessRow { group: string; total: number | "<10"; held: number | "<10"; rate: number | null; flagged: boolean }
export interface Fairness { weekStart: string; language: FairnessRow[]; city: FairnessRow[]; note: string }

export const useCases = (f: { status?: string; kind?: string; band?: string; breached?: boolean }) => useQuery({ queryKey: ["growth", "fraud", "cases", f], queryFn: () => rawApi<{ rows: CaseRow[] }>("GET", `${B}/cases${qs(f)}`) });
export const useCaseSummary = () => useQuery({ queryKey: ["growth", "fraud", "summary"], queryFn: () => rawApi<CaseSummary>("GET", `${B}/cases/summary`) });
export const useCaseEvidence = (id: string | null) => useQuery({ queryKey: ["growth", "fraud", "case", id], enabled: !!id, queryFn: () => rawApi<CaseEvidence>("GET", `${B}/cases/${encodeURIComponent(id!)}`) });
export const useFraudRules = () => useQuery({ queryKey: ["growth", "fraud", "rules"], queryFn: () => rawApi<RulesView>("GET", `${B}/rules`) });
export const useShadowReport = (days: number) => useQuery({ queryKey: ["growth", "fraud", "shadow", days], queryFn: () => rawApi<ShadowReport>("GET", `${B}/shadow-report${qs({ days })}`) });
export const useFairness = () => useQuery({ queryKey: ["growth", "fraud", "fairness"], queryFn: () => rawApi<Fairness>("GET", `${B}/fairness`) });

export type CaseAction =
  | { op: "assign"; id: string; assignTo: string }
  | { op: "decide"; id: string; decision: "CONFIRM" | "DISMISS"; note?: string; reverseRewards?: boolean; suspendDays?: number }
  | { op: "appeal"; id: string; note: string }
  | { op: "appeal-decision"; id: string; decision: "CONFIRM" | "DISMISS"; note: string }
  | { op: "bulk-dismiss"; ids: string[]; reason: string };
export function useCaseAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: CaseAction) => {
      const path = a.op === "bulk-dismiss" ? `${B}/cases/bulk-dismiss` : a.op === "decide" ? `${B}/cases/${encodeURIComponent(a.id)}/decision` : a.op === "assign" ? `${B}/cases/${encodeURIComponent(a.id)}/assign` : a.op === "appeal" ? `${B}/cases/${encodeURIComponent(a.id)}/appeal` : `${B}/cases/${encodeURIComponent(a.id)}/appeal-decision`;
      const { op: _op, ...body } = a as Record<string, unknown>; const { id: _id, ...rest } = body;
      return rawApi<Record<string, unknown>>("POST", path, a.op === "bulk-dismiss" ? body : rest);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["growth", "fraud"] }); },
  });
}
