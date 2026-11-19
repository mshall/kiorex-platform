import { useState } from "react";
import { Pressable, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/errors";
import { useBooking, useSubmitReview } from "@/api/hooks";
import { Icon } from "@/components/Icon";
import { ErrorState, LoadingState, UnavailableState } from "@/components/states";
import { Banner, Button, Card, Field, Row, Screen, T } from "@/components/ui";
import { useFeature } from "@/hooks/useFeature";
import { track } from "@/lib/analytics";
import { pick } from "@/lib/format";
import { useTheme } from "@/theme";

/** Review submission (KXMRV01): completed visits only. The comment must not contain medical or personal details. */
export default function ReviewScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const booking = useBooking(id);
  const submit = useSubmitReview();
  const reviews = useFeature("kiorex.reviews");
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (booking.isLoading) return <LoadingState />;
  if (booking.error || !booking.data) return <ErrorState error={booking.error} onRetry={() => void booking.refetch()} />;
  if (!reviews.enabled) return <Screen><UnavailableState featureKey="kiorex.reviews" /></Screen>;
  const b = booking.data;
  if (b.status !== "COMPLETED") return <Screen><Banner tone="warning" title={t("review.notEligible")} body={t("review.onlyCompleted")} /></Screen>;

  const send = () => submit.mutate({ bookingId: id, rating, text: text.trim() || undefined }, {
    onSuccess: () => { track("review_submitted", { bookingId: id, rating }); setDone(true); },
    onError: (e) => setMsg(e instanceof ApiError && e.isFeatureDisabled ? t("unavailable.title") : e instanceof ApiError && (e.code === "REVIEW_EXISTS" || e.code === "NOT_A_COMPLETED_VISIT") ? t("review.notEligible") : t("review.failed")),
  });

  if (done) return <Screen testID="review-done"><Banner tone="success" title={t("review.thanks")} /><Button title={t("common.done")} onPress={() => router.back()} /></Screen>;
  return (
    <Screen testID="review" style={{ gap: 14 }} footer={<Button testID="submit-review" title={t("review.submit")} disabled={rating < 1} loading={submit.isPending} onPress={send} />}>
      <T variant="title" accessibilityRole="header">{t("review.title", { name: b.doctor ? pick(b.doctor, "name", i18n.language) : "" })}</T>
      <Card style={{ gap: 10 }}>
        <T variant="label">{t("review.rating")}</T>
        <Row gap={4} accessibilityRole="radiogroup">
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} testID={`star-${n}`} accessibilityRole="radio" accessibilityState={{ checked: rating === n }} accessibilityLabel={`${n}`} onPress={() => setRating(n)} style={{ width: 52, height: 52, alignItems: "center", justifyContent: "center" }}>
              <Icon name="star" size={36} color={n <= rating ? colors.pulse : colors.muted} fill={n <= rating ? colors.pulse : "none"} />
            </Pressable>
          ))}
        </Row>
        <Field testID="review-text" label={t("review.text")} value={text} onChangeText={setText} multiline numberOfLines={4} maxLength={1000} style={{ minHeight: 110, textAlignVertical: "top", paddingTop: 12 }} />
        <T variant="caption" muted>{t("review.phiWarning")} {t("review.editWindow")}</T>
      </Card>
      {msg ? <Banner tone="danger" body={msg} /> : null}
      <View />
    </Screen>
  );
}
