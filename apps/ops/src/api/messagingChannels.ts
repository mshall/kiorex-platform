// MSG-REAL: typed hooks over /api/v1/admin/messaging/channels/*. Nothing here sends or receives a secret: the status shows `secretRef` names and a boolean "present".
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";

const B = "/admin/messaging/channels";
export interface ChannelProvider { provider: string; problems: string[]; secretRef: string | null; secretRefPresent: boolean | null }
export interface ChannelRow { channel: "EMAIL" | "WHATSAPP" | "SMS" | "PUSH"; mode: "mock" | "real"; enabled: boolean; senderId: string | null; providers: ChannelProvider[]; ready: boolean; webhook: string | null; state?: { quality: Record<string, unknown> | null; throttle: Record<string, unknown> | null; auth: Record<string, unknown> | null } }
export interface ChannelsStatus { market: string; publicBaseUrl: string; failoverOrder: Record<string, string[]>; quietHours?: { start?: string; end?: string; timezone?: string; channels?: string[] }; channels: ChannelRow[]; testAllowListSize: number }
export interface CheckItem { name: string; ok: boolean; detail: string; skipped?: boolean }
export interface WebhookInfo { channel: string; provider?: string; callbackUrl?: string; subscriptionUrl?: string; verifyToken?: string | null; verifyTokenSet?: boolean; webhookSecretSet?: boolean; appSecretSet?: boolean; subscribeFields?: string[]; steps?: string[]; note?: string }
export interface TemplateRow { key: string; language: string; metaName: string; category: string; status: string; quality: string | null; reason: string | null; enabled: boolean }

export const useChannelsStatus = () => useQuery({ queryKey: ["msg", "channels"], queryFn: () => rawApi<ChannelsStatus>("GET", B) });
export const useWebhookInfo = (channel: string | null) => useQuery({ queryKey: ["msg", "webhook", channel], enabled: !!channel, queryFn: () => rawApi<WebhookInfo>("GET", `${B}/${channel!.toLowerCase()}/webhook`) });
export const useWaTemplates = () => useQuery({ queryKey: ["msg", "templates"], queryFn: () => rawApi<TemplateRow[]>("GET", `${B}/whatsapp/templates`) });
export function useChannelActions() {
  const qc = useQueryClient(); const done = () => void qc.invalidateQueries({ queryKey: ["msg"] });
  return {
    reveal: useMutation({ mutationFn: (channel: string) => rawApi<WebhookInfo>("POST", `${B}/${channel.toLowerCase()}/webhook/reveal`) }),
    testSend: useMutation({ mutationFn: (v: { channel: string; to: string }) => rawApi<{ ok: boolean; status: string; mode: string; error: string | null; hint?: string }>("POST", `${B}/${v.channel.toLowerCase()}/test-send`, { to: v.to }), onSuccess: done }),
    check: useMutation({ mutationFn: (channel: string) => rawApi<{ channel: string; mode: string; ok: boolean; checks: CheckItem[] }>("POST", `${B}/${channel.toLowerCase()}/connection-check`), onSuccess: done }),
    sync: useMutation({ mutationFn: () => rawApi<{ seen: number; updated: number }>("POST", `${B}/whatsapp/templates/sync`), onSuccess: done }),
    exportTemplates: useMutation({ mutationFn: () => rawApi<unknown[]>("GET", `${B}/whatsapp/templates/export`) }),
  };
}
