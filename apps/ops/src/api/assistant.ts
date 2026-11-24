// WhatsApp AI booking assistant (GRW-P2-D): typed hooks over /api/v1/admin/growth/assistant. No phone number and no subject appears in any response.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";

const B = "/admin/growth/assistant";
export interface AssistantStatus {
  market: string; mode: "mock" | "fixture" | "real"; model: string;
  policy: { source: "ACTIVE" | "PROPOSED_DEFAULT"; versionId: string; retentionDays: number; escalationSlaMinutes: number; model: { mode: string; providerLabel: string } };
  flags: { assistant: { key: string; effective: boolean; reason: string; blockedBy: string | null }; realModel: { key: string; effective: boolean; reason: string } };
  realModelConfigured: boolean;
  usageToday: { tokens: number; costMinor: number; conversations: number; breakerTripped: boolean };
  budgets: { tokensPerTurn: number; tokensPerConversation: number; turnsPerConversation: number; tokensPerSubjectDay: number; costPerMarketDayMinor: number };
  rateLimits: { messagesPerNumberPerHour: number; globalConcurrency: number };
  escalations: { open: number; overdue: number };
}
export interface ConversationRow { id: string; createdAt: string; state: string; language: string; turns: number; tokens: number; costMinor: number; verified: boolean; escalated: boolean; escalationStatus: string | null; expiresAt: string }
export interface TranscriptTurn { seq: number; direction: "IN" | "OUT"; text: string; template: string | null; outcome: string; at: string }
export interface ConversationDetail { id: string; state: string; language: string; verified: boolean; createdAt: string; turns: TranscriptTurn[]; toolCalls: Array<{ tool: string; argsRedacted: Record<string, unknown>; resultKind: string; createdAt: string }> }
export interface EscalationRow { id: string; sessionId: string; reason: string; status: "OPEN" | "ACKED" | "CLOSED"; ackBy: string | null; createdAt: string; slaDueAt: string; overdue: boolean; minutesLeft: number; closedAt: string | null }
export interface EscalationDetail { id: string; sessionId: string; reason: string; status: string; slaDueAt: string; transcript: Array<{ seq: number; direction: string; text: string; template: string | null; outcome: string; at: string }> }
export interface Budgets { market: string; budgets: AssistantStatus["budgets"]; rateLimits: AssistantStatus["rateLimits"]; days: Array<{ day: string; tokens: number; costMinor: number; conversations: number; breakerTripped: boolean }> }
export interface AssistantMetrics { masked: boolean; k: number; sessions: number | null; containmentRate: number | null; handoffRate: number | null; bookingCompletionRate: number | null; costPerBookingMinor: number | null; p95LatencyMs: number | null }

const inv = (qc: ReturnType<typeof useQueryClient>) => void qc.invalidateQueries({ queryKey: ["assistant"] });
export const useAssistantStatus = () => useQuery({ queryKey: ["assistant", "status"], queryFn: () => rawApi<AssistantStatus>("GET", `${B}/status`), refetchInterval: 30_000 });
export const useConversations = (state?: string) => useQuery({ queryKey: ["assistant", "conversations", state], queryFn: () => rawApi<ConversationRow[]>("GET", `${B}/conversations${state ? `?state=${encodeURIComponent(state)}` : ""}`) });
export const useConversation = (id: string | null) => useQuery({ queryKey: ["assistant", "conversation", id], enabled: !!id, queryFn: () => rawApi<ConversationDetail>("GET", `${B}/conversations/${id}`) });
export const useEscalations = (status?: string) => useQuery({ queryKey: ["assistant", "escalations", status], queryFn: () => rawApi<EscalationRow[]>("GET", `${B}/escalations${status ? `?status=${status}` : ""}`), refetchInterval: 30_000 });
export const useEscalation = (id: string | null) => useQuery({ queryKey: ["assistant", "escalation", id], enabled: !!id, queryFn: () => rawApi<EscalationDetail>("GET", `${B}/escalations/${id}`) });
export const useBudgets = () => useQuery({ queryKey: ["assistant", "budgets"], queryFn: () => rawApi<Budgets>("GET", `${B}/budgets`) });
export const useAssistantMetrics = (days = 30) => useQuery({ queryKey: ["assistant", "metrics", days], queryFn: () => rawApi<AssistantMetrics>("GET", `${B}/metrics?days=${days}`) });
export const useAckEscalation = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => rawApi("POST", `${B}/escalations/${id}/ack`), onSuccess: () => inv(qc) }); };
export const useCloseEscalation = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => rawApi("POST", `${B}/escalations/${id}/close`), onSuccess: () => inv(qc) }); };
export const useResetBreaker = () => { const qc = useQueryClient(); return useMutation({ mutationFn: () => rawApi("POST", `${B}/budgets/reset-breaker`), onSuccess: () => inv(qc) }); };
