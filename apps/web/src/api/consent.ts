import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./client";
import type { components } from "./schema";

/** GRW-P1-I preference centre (GET/PUT /me/preferences). The server answers a free-form object; this is its documented shape. */
export type MarketingChannel = "WHATSAPP" | "SMS" | "EMAIL" | "PUSH";
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
export type PreferencesUpdate = Omit<components["schemas"]["PreferencesBody"], "source" | "marketing"> & { marketing?: Partial<Record<MarketingChannel, boolean>> };

const key = ["preferences"] as const;
export const usePreferences = (enabled = true) => useQuery({ queryKey: key, enabled, queryFn: async () => (await unwrap(api.GET("/api/v1/me/preferences"))) as unknown as PreferencesView });

export const useUpdatePreferences = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: PreferencesUpdate) => (await unwrap(api.PUT("/api/v1/me/preferences", { body: { ...body, source: "web" } }))) as unknown as PreferencesView,
    onSuccess: (data) => qc.setQueryData(key, data),
  });
};

export const useUnsubscribeMarketing = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await unwrap(api.POST("/api/v1/me/preferences/unsubscribe-marketing"))) as unknown as PreferencesView,
    onSuccess: (data) => qc.setQueryData(key, data),
  });
};
