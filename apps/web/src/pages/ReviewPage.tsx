import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useBooking, useSubmitReview } from "@/api/hooks";
import { ApiError } from "@/api/errors";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { StarInput } from "@/components/StarRating";
import { FeatureGate } from "@/hooks/useFeature";
import { pick } from "@/lib/format";
import { track } from "@/lib/analytics";

function ReviewForm() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const q = useBooking(id);
  const submit = useSubmitReview();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  if (q.isLoading) return <LoadingState />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const b = q.data;
  if (!b.reviewable) return <EmptyState title={b.reviewed ? t("appointment.reviewed") : t("review.notEligible")} hint={t("review.onlyCompleted")} />;

  return (
    <form className="mx-auto max-w-xl space-y-5" onSubmit={(e) => {
      e.preventDefault();
      submit.mutate({ bookingId: id, rating, text: text.trim() || undefined }, {
        onSuccess: () => { track("review_submitted", { rating, doctorId: b.doctor.id }); toast.success(t("review.thanks")); nav(`/appointments/${id}`); },
        onError: (err) => toast.error(err instanceof ApiError && err.isFeatureDisabled ? t("unavailable.title") : t("review.failed")),
      });
    }}>
      <h1 className="text-2xl">{t("review.title", { name: pick(b.doctor, "name", i18n.language) })}</h1>
      <div className="space-y-2"><Label>{t("review.rating")}</Label><StarInput value={rating} onChange={setRating} label={t("review.rating")} /></div>
      <div className="space-y-2">
        <Label htmlFor="review-text">{t("review.text")}</Label>
        <Textarea id="review-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} rows={5} />
        <p className="text-xs text-muted-foreground">{t("review.phiWarning")}</p>
      </div>
      <p className="text-xs text-muted-foreground">{t("review.editWindow")}</p>
      <Button type="submit" size="lg" disabled={rating === 0 || submit.isPending} data-testid="submit-review">{t("review.submit")}</Button>
    </form>
  );
}

export default function ReviewPage() {
  return <FeatureGate flag="kiorex.reviews"><ReviewForm /></FeatureGate>;
}
