// Integrations Control Center: typed hooks over /api/v1/admin/integrations-center. Names and booleans only; the API never returns a credential.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";

const B = "/admin/integrations-center";
export type IcMode = "mock" | "real" | null;
export type IcDrift = "NONE" | "APPROVED_NOT_DEPLOYED" | "REAL_NOT_APPROVED";
export interface IcEnv { name: string; required: boolean; set: boolean }
export interface IcRow {
  key: string; group: "payments" | "messaging" | "push" | "marketing" | "ai" | "platform"; label: { en: string; ar: string }; owner: "kiorex" | "clinic" | "passport" | "aws"; observable: boolean;
  mode: IcMode; approvedMode: "mock" | "real"; drift: IcDrift; secretRefSet: boolean; ready: boolean; problems: string[]; env: IcEnv[];
  circuit: { state: string; consecutiveFailures: number; lastOkAt: string | null; lastErrorAt: string | null; source: string } | null;
  lastRun: { status: string; rows: number; error: string | null; startedAt: string } | null;
  lastCheck: { at: string; ok: boolean; detail: string; by: string } | null;
  webhook: { path: string; url: string | null; verifyTokenEnv: string | null; verifyTokenSet: boolean | null; secretEnv: string | null; secretSet: boolean | null; note: string | null } | null;
  growthKind: string | null; testSend: "SMS" | "EMAIL" | "WHATSAPP" | "PUSH" | null; runbook: string; needsHuman: string[]; note: string | null;
}
export interface IcOverview {
  generatedAt: string; market: string; canManage: boolean;
  summary: { total: number; real: number; mock: number; unobservable: number; drift: number; notReady: number };
  counsel?: { market: string; status: string; reviewedOn: string | null; realBlocked: number; page: string } | null; approvedModes: Record<string, "mock" | "real">; pendingProposal: { id: string; status: string; modes: Record<string, string>; createdBy: string; createdAt: string } | null;
  integrations: IcRow[]; rules: { secrets: string; switching: string; checks: string };
}
export const useIntegrationsCenter = () => useQuery({ queryKey: ["integrations-center"], queryFn: () => rawApi<IcOverview>("GET", B) });
const useInvalidating = <V, R>(fn: (v: V) => Promise<R>) => { const qc = useQueryClient(); return useMutation({ mutationFn: fn, onSuccess: () => { void qc.invalidateQueries({ queryKey: ["integrations-center"] }); } }); };
export const useIcCheck = () => useInvalidating((key: string) => rawApi<{ key: string; ok: boolean; mode: IcMode; detail: string; checkedAt: string }>("POST", `${B}/${key}/check`));
export const useIcTestSend = () => useInvalidating((v: { key: string; to: string }) => rawApi<{ key: string; ok: boolean; mode: "mock"; providerRef: string; error: string | null; to: string }>("POST", `${B}/${v.key}/test-send`, { to: v.to }));
export const useIcProposeMode = () => useInvalidating((v: { key: string; mode: "mock" | "real"; reason: string }) => rawApi<{ id: string; status: string; key: string; mode: string }>("POST", `${B}/${v.key}/propose-mode`, { mode: v.mode, reason: v.reason }));
