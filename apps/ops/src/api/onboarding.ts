/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed fixtures and the import console wire shape (resolution tasks carry arbitrary context) */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";

export type Severity = "BLOCKER" | "WARNING" | "INFO";
export type TaskStatus = "OPEN" | "RESOLVED" | "IGNORED";
export type TaskAction = "MAP_TABLE" | "MAP_COLUMN" | "EDIT_VALUE" | "SKIP_ROW" | "MERGE" | "KEEP_BOTH" | "ASSIGN_PATIENT" | "ASSIGN_FILE" | "SKIP_FILE" | "ACCEPT_REPAIR" | "CHOOSE_DATE_FORMAT" | "IGNORE";
export interface ImportTask { id: string; key: string; type: string; severity: Severity; status: TaskStatus; entity?: string; ref?: { sourceKey?: string; field?: string; table?: string; fileId?: string }; context: Record<string, any>; suggestion?: Record<string, any>; actions: TaskAction[]; resolution?: { action: TaskAction; reason?: string } }
export interface ImportBatch { id: string; orgId: string; orgName: string; label?: string | null; status: string; createdBy: string; requestedBy?: string | null; approvedBy?: string | null; createdAt: string; summary?: { classification: Array<{ table: string; entity: string | null; score: number; rows: number }>; mappings: Record<string, Array<{ field: string; column: string | null; confidence: number }>>; stats: { rows: Record<string, number>; blockers: number; warnings: number; tasksOpen: number; filesMatched: number; filesTotal: number; mergedPatients: number } } | null; progress?: Record<string, any> | null; files?: Array<{ id: string; name: string; kind: string; rejectReason?: string | null; size: number }> }
export interface DryRun { batchId: string; status: string; reportHash: string; canCommit: boolean; willCreate: Record<string, number>; filesToAttach: number; mergedPatients: number; skippedFiles: number; openBlockers: number; openWarnings: number; ignoredWithReason: number; targetMode: string; taskBreakdown: Array<{ type: string; status: string; count: number }> }
export interface TaskPage { total: number; page: number; pageSize: number; counts: Array<{ status: string; severity: string; count: number }>; items: ImportTask[] }

const K = { list: ["onb", "list"] as const, one: (id: string) => ["onb", id] as const, tasks: (id: string, f: string) => ["onb", id, "tasks", f] as const, dry: (id: string) => ["onb", id, "dry"] as const, audit: (id: string) => ["onb", id, "audit"] as const };
const B = "/admin/onboarding/imports";

export const useImports = () => useQuery({ queryKey: K.list, queryFn: () => rawApi<ImportBatch[]>("GET", B) });
export const useImport = (id: string) => useQuery({ queryKey: K.one(id), queryFn: () => rawApi<ImportBatch>("GET", `${B}/${id}`), refetchInterval: (q) => (["COMMITTING", "ROLLING_BACK"].includes(q.state.data?.status ?? "") ? 2000 : false) });
export const useImportTasks = (id: string, f: { status: string; severity: string; type: string; page: number }) => {
  const qs = new URLSearchParams({ pageSize: "25", page: String(f.page), ...(f.status ? { status: f.status } : {}), ...(f.severity ? { severity: f.severity } : {}), ...(f.type ? { type: f.type } : {}) }).toString();
  return useQuery({ queryKey: K.tasks(id, qs), queryFn: () => rawApi<TaskPage>("GET", `${B}/${id}/tasks?${qs}`) });
};
export const useDryRun = (id: string) => useQuery({ queryKey: K.dry(id), queryFn: () => rawApi<DryRun>("GET", `${B}/${id}/dry-run`) });
export const useImportAudit = (id: string) => useQuery({ queryKey: K.audit(id), queryFn: () => rawApi<Array<{ id: string; actor: string; action: string; createdAt: string; metadata?: Record<string, unknown> | null }>>("GET", `${B}/${id}/audit`) });
export const usePatientLookup = (id: string, q: string) => useQuery({ queryKey: ["onb", id, "patients", q], queryFn: () => rawApi<Array<{ sourceKey: string; name: string; phone: string }>>("GET", `${B}/${id}/patients?q=${encodeURIComponent(q)}`), enabled: q.length >= 1 });

function useInvalidate(id?: string) { const qc = useQueryClient(); return () => qc.invalidateQueries({ queryKey: id ? ["onb", id] : ["onb"] }).then(() => qc.invalidateQueries({ queryKey: K.list })); }
export const useCreateImport = () => { const inv = useInvalidate(); return useMutation({ mutationFn: (b: { orgId: string; orgName: string; label?: string }) => rawApi<ImportBatch>("POST", B, b), onSuccess: inv }); };
export const useUploadFile = (id: string) => { const inv = useInvalidate(id); return useMutation({ mutationFn: async (f: File) => rawApi<{ id: string; kind: string; rejectReason?: string }>("POST", `${B}/${id}/files?name=${encodeURIComponent(f.name)}`, await f.arrayBuffer(), { binary: true }), onSuccess: inv }); };
export const useResolve = (id: string) => { const inv = useInvalidate(id); return useMutation({ mutationFn: (v: { taskId: string; action: TaskAction; params?: Record<string, unknown>; reason?: string }) => rawApi("POST", `${B}/${id}/tasks/${v.taskId}/resolve`, { action: v.action, params: v.params, reason: v.reason }), onSuccess: inv }); };
export const useBatchAction = (id: string) => { const inv = useInvalidate(id); return useMutation({ mutationFn: (v: { path: "request-commit" | "approve" | "reject" | "commit" | "rollback" | "purge-staging" | "rescan"; body?: unknown }) => rawApi<any>("POST", `${B}/${id}/${v.path}`, v.body ?? {}), onSuccess: inv, onError: inv }); };
