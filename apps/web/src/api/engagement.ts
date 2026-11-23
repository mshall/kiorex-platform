import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./client";
import type { components } from "./schema";
import { qk } from "./hooks";

type S = components["schemas"];
export type InboxItem = S["InboxItemDto"];
export type NotificationPref = S["NotificationPreferenceDto"];
export type ProfileUpdate = S["ProfileBody"];

const ek = { inbox: ["notifications"] as const, prefs: ["notification-prefs"] as const, history: ["consent-history"] as const };

/** KXM-NT-01 in-app inbox. Polled lightly so the bell badge follows new booking / lab / waitlist messages. */
export const useNotifications = (enabled = true) =>
  useQuery({ queryKey: ek.inbox, enabled, refetchInterval: 60_000, queryFn: () => unwrap(api.GET("/api/v1/me/notifications")) });

export const useMarkRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.POST("/api/v1/me/notifications/{id}/read", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ek.inbox }),
  });
};

/** KXM-NT-02 per-channel opt-out and quiet hours. */
export const useNotificationPrefs = () => useQuery({ queryKey: ek.prefs, queryFn: () => unwrap(api.GET("/api/v1/me/notification-preferences")) });

export const useSetNotificationPref = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { channel: NotificationPref["channel"]; enabled?: boolean; quietStart?: number; quietEnd?: number }) => {
      const { channel, ...body } = v;
      return unwrap(api.PUT("/api/v1/me/notification-preferences/{channel}", { params: { path: { channel } }, body }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ek.prefs }),
  });
};

/** KXM-AC-02 profile update (name, language, email). */
export const useUpdateProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProfileUpdate) => unwrap(api.PUT("/api/v1/me/profile", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.me }),
  });
};

/** KXM-AC-06 data export: the patient's own profile, family and consents as JSON. */
export const useExportData = () => useMutation({ mutationFn: () => unwrap(api.POST("/api/v1/me/export")) });

/** KXM-AC-04 consent history (every grant / withdrawal with its source). */
export const useConsentHistory = () => useQuery({ queryKey: ek.history, queryFn: () => unwrap(api.GET("/api/v1/me/consents/history")) });

/** KXM-RV-01: the patient's own reviews (a booking is "reviewed" when one exists; editable for 7 days). */
export const useMyReviews = (enabled = true) => useQuery({ queryKey: ["my-reviews"] as const, enabled, queryFn: () => unwrap(api.GET("/api/v1/me/reviews")) });

export const useEditReview = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; rating?: number; text?: string }) => unwrap(api.PUT("/api/v1/reviews/{id}", { params: { path: { id: v.id } }, body: { rating: v.rating, text: v.text } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-reviews"] }),
  });
};
