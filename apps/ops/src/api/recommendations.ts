// GRW-P3-E: typed hooks over /api/v1/admin/growth/recommendations. Advisory only: a recommendation is decided by a person; approval creates at most a DRAFT.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";

const B = "/admin/growth/recommendations";
export type RecKind = "REALLOCATE_BUDGET" | "PAUSE_CAMPAIGN" | "CONTENT_SUGGESTION" | "SEO_GAP" | "LIFECYCLE_HOLDOUT";
export type RecStatus = "PROPOSED" | "APPROVED" | "REJECTED" | "EXPIRED" | "CONVERTED";
export interface Recommendation {
  id: string; market: string; kind: RecKind; payload: Record<string, unknown>; rationale: { en: string; ar: string }; evidenceRefs: Array<{ source: string; ref: string; window?: string }>; confidence: number; status: RecStatus;
  decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; convertedRef: string | null; modelMode: "rules" | "mock" | "real"; aiAssisted: boolean; aiSummary: { en: string; ar: string; label: string; model: string } | null;
  feedback: "USEFUL" | "NOT_USEFUL" | null; expiresAt: string; createdAt: string; next: { screen: string } | null; conversionError?: string | null;
}
export interface RecCatalog { kinds: RecKind[]; policy: { k: number; expiryDays: number; maxPerRun: number; maxShiftBp: number }; mode: string }
const qs = (o: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v) p.set(k, v); const s = p.toString(); return s ? `?${s}` : ""; };
export const useRecCatalog = () => useQuery({ queryKey: ["growth", "rec-catalog"], staleTime: 300_000, queryFn: () => rawApi<RecCatalog>("GET", `${B}/catalog`) });
export const useRecommendations = (f: { status?: string; kind?: string } = {}) => useQuery({ queryKey: ["growth", "recommendations", f], queryFn: () => rawApi<Recommendation[]>("GET", `${B}${qs(f)}`) });
export const useRecommendation = (id: string | null) => useQuery({ queryKey: ["growth", "recommendation", id], enabled: !!id, queryFn: () => rawApi<Recommendation>("GET", `${B}/${id}`) });
export function useRecommendationActions() {
  const qc = useQueryClient(); const done = () => qc.invalidateQueries({ queryKey: ["growth"] });
  return {
    run: useMutation({ mutationFn: () => rawApi<{ created: number; existing: number; considered: number; mode: string }>("POST", `${B}/run`, {}), onSuccess: done }),
    decide: useMutation({ mutationFn: (v: { id: string; decision: "APPROVE" | "REJECT"; note?: string }) => rawApi<Recommendation>("POST", `${B}/${v.id}/decision`, { decision: v.decision, note: v.note }), onSuccess: done }),
    feedback: useMutation({ mutationFn: (v: { id: string; value: "USEFUL" | "NOT_USEFUL" }) => rawApi<Recommendation>("POST", `${B}/${v.id}/feedback`, { value: v.value }), onSuccess: done }),
  };
}
