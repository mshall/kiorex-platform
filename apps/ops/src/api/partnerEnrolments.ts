import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";

export interface EnrolmentRow { id: string; kind: "CLINIC" | "NURSE" | "PHARMACY" | "LAB"; orgRef: string | null; label: string; status: "ACTIVE" | "USED" | "REVOKED" | "EXPIRED"; expiresAt: string; createdBy: string; usedAt: string | null; createdAt: string }
export interface EnrolmentCreated extends EnrolmentRow { code: string; shownOnce: true }
const B = "/admin/onboarding/enrolments";
const KEY = ["pob", "enrolments"] as const;

export const useEnrolments = () => useQuery({ queryKey: KEY, queryFn: () => rawApi<EnrolmentRow[]>("GET", B) });
export function useCreateEnrolment() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: { kind: string; label: string; orgRef?: string; ttlHours?: number }) => rawApi<EnrolmentCreated>("POST", B, b), onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }) });
}
export function useRevokeEnrolment() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => rawApi<EnrolmentRow>("DELETE", `${B}/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }) });
}
