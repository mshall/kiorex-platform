// GRW-P3-E: typed hooks over /api/v1/admin/growth/automation. A journey is a closed graph (no scripting); nothing here sends a message: the console builds, validates, dry-runs and publishes definitions.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";

const B = "/admin/growth/automation";
export type JourneyStatus = "DRAFT" | "PENDING_APPROVAL" | "PUBLISHED" | "RETIRED";
export interface GraphNode { id: string; type: string; label?: string; event?: string; minutes?: number; segment?: Record<string, unknown>; template?: string; channels?: string[]; experiment?: string }
export interface GraphEdge { from: string; to: string; label?: string }
export interface JourneyGraph { schema: 1; nodes: GraphNode[]; edges: GraphEdge[] }
export interface Journey {
  id: string; market: string; key: string; version: number; status: JourneyStatus; name: string; graph: JourneyGraph; checksum: string; createdBy: string; approvedBy: string | null; submittedAt: string | null; publishedAt: string | null;
  retiredAt: string | null; killedAt: string | null; killedBy: string | null; killReason: string | null; createdAt: string;
}
export interface CompiledStep { step: number; nodeId: string; template: string; messageClass: string; delayMinutes: number; channels: string[]; branch: Array<{ experiment: string; variant: string }>; conditions: number; gateInserted: boolean }
export interface Compiled { steps: CompiledStep[]; gateNodes: Array<{ beforeStep: number; checks: string[] }>; truncated: boolean; trigger: string; key: string }
export interface JourneyDetail extends Journey { compiled: Compiled | null; activeEnrolments: number; runLog: Array<{ day: string; enrolled: number; sent: number; skipped: number; ended: number; byReason: Record<string, number> }> }
export interface ValidationError { code: string; path: string; message: string }
export type Validation = { valid: true; errors: []; checksum: string; compiled: Compiled } | { valid: false; errors: ValidationError[] };
export interface DryRunStep { step: number; template: string; messageClass: string; reached: number; sent: number; skipped: Record<string, number>; deferred: number }
export interface DryRun { checksum: string; compiled: Compiled; result: { cohort: number; seed: number; steps: DryRunStep[]; totalSent: number; exits: Record<string, number>; gateNodes: Compiled["gateNodes"]; perPersonMax: number; marketingFlagOn: boolean; note: { en: string; ar: string } } }
export interface Catalog { nodeTypes: string[]; triggers: string[]; channels: string[]; attributes: string[]; branchSurface: string; policy: { maxNodes: number; minWaitMinutes: number; maxWaitMinutes: number; maxSendsPerJourney: number; maxSendsPer30Days: number }; templates: Array<{ key: string; messageClass: string; channels: string[] }> }
export interface Status { market: string; automation: { effective: boolean; reason: string }; marketingLicence: { effective: boolean; reason: string; flag: string }; lifecycleJourneys: boolean }

const qs = (o: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v) p.set(k, v); const s = p.toString(); return s ? `?${s}` : ""; };
export const useAutomationCatalog = () => useQuery({ queryKey: ["growth", "automation-catalog"], staleTime: 300_000, queryFn: () => rawApi<Catalog>("GET", `${B}/catalog`) });
export const useAutomationStatus = () => useQuery({ queryKey: ["growth", "automation-status"], queryFn: () => rawApi<Status>("GET", `${B}/status`) });
export const useJourneys = (f: { status?: string } = {}) => useQuery({ queryKey: ["growth", "journeys", f], queryFn: () => rawApi<Journey[]>("GET", `${B}/journeys${qs(f)}`) });
export const useJourney = (id: string | null) => useQuery({ queryKey: ["growth", "journey", id], enabled: !!id, queryFn: () => rawApi<JourneyDetail>("GET", `${B}/journeys/${id}`) });

export function useJourneyActions() {
  const qc = useQueryClient(); const done = () => qc.invalidateQueries({ queryKey: ["growth"] });
  return {
    validate: useMutation({ mutationFn: (graph: JourneyGraph) => rawApi<Validation>("POST", `${B}/validate`, { graph }) }),
    dryRun: useMutation({ mutationFn: (v: { graph: JourneyGraph; size?: number; seed?: number }) => rawApi<DryRun>("POST", `${B}/dry-run`, v) }),
    create: useMutation({ mutationFn: (b: { key: string; name: string; graph: JourneyGraph }) => rawApi<Journey>("POST", `${B}/journeys`, b), onSuccess: done }),
    update: useMutation({ mutationFn: (v: { id: string; name?: string; graph?: JourneyGraph }) => rawApi<Journey>("PATCH", `${B}/journeys/${v.id}`, { name: v.name, graph: v.graph }), onSuccess: done }),
    submit: useMutation({ mutationFn: (id: string) => rawApi<Journey>("POST", `${B}/journeys/${id}/submit`), onSuccess: done }),
    approve: useMutation({ mutationFn: (id: string) => rawApi<Journey & { warnings: string[] }>("POST", `${B}/journeys/${id}/approve`), onSuccess: done }),
    reject: useMutation({ mutationFn: (v: { id: string; reason: string }) => rawApi<Journey>("POST", `${B}/journeys/${v.id}/reject`, { reason: v.reason }), onSuccess: done }),
    retire: useMutation({ mutationFn: (id: string) => rawApi<Journey>("POST", `${B}/journeys/${id}/retire`), onSuccess: done }),
    kill: useMutation({ mutationFn: (v: { id: string; reason: string }) => rawApi<Journey>("POST", `${B}/journeys/${v.id}/kill`, { reason: v.reason }), onSuccess: done }),
  };
}
