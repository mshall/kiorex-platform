// GRW-P1-I patient preference centre on the app: the SAME server APIs as the web (GET/PUT /me/preferences, POST /me/preferences/unsubscribe-marketing).
// The server answers a free-form object; `PreferencesView` is its documented shape (Docs/CONSENT.md).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, send } from "./client";
import type { S } from "./types";

export type MarketingChannel = "WHATSAPP" | "SMS" | "EMAIL" | "PUSH";
export const MARKETING_CHANNELS: MarketingChannel[] = ["WHATSAPP", "SMS", "EMAIL", "PUSH"];
export interface PreferencesView {
  version: number;
  draftWording: boolean;
  textVersions: { analytics: string; marketing: string };
  serviceMessages: Array<{ purpose: "TRANSACTIONAL" | "SECURITY" | "CLINICAL"; required: true }>;
  reminders: { consent: boolean; updatedAt: string | null };
  analytics: { consent: boolean; textVersion: string | null; updatedAt: string | null };
  marketing: { available: boolean; anyConsent: boolean; channels: Array<{ channel: MarketingChannel; marketingConsent: boolean; channelEnabled: boolean; suppressed: boolean; quietStart: number | null; quietEnd: number | null }> };
  quietHours: { start: number | null; end: number | null; defaultStart: number; defaultEnd: number; timezone: string };
  caps: { perDay: number; perWeek: number };
  withdrawalPropagationSeconds: number;
}
export type PreferencesUpdate = Omit<S["PreferencesBody"], "source" | "marketing"> & { marketing?: Partial<Record<MarketingChannel, boolean>> };

export const prefKey = ["preferences"] as const;
export const usePreferences = (enabled = true) => useQuery({ queryKey: prefKey, enabled, queryFn: async () => (await send(api.GET("/api/v1/me/preferences"))) as unknown as PreferencesView });
export const useUpdatePreferences = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: PreferencesUpdate) => (await send(api.PUT("/api/v1/me/preferences", { body: { ...body, source: "app" } }))) as unknown as PreferencesView,
    onSuccess: (data) => qc.setQueryData(prefKey, data),
  });
};
export const useUnsubscribeMarketing = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await send(api.POST("/api/v1/me/preferences/unsubscribe-marketing"))) as unknown as PreferencesView,
    onSuccess: (data) => qc.setQueryData(prefKey, data),
  });
};
