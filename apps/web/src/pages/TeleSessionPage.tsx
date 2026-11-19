import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/api/errors";
import { useEndTeleSession, useJoinTeleSession, useTeleSession, type TeleSession } from "@/api/services";
import type { components } from "@/api/schema";
import { EmptyState, ErrorState, LoadingState, MockNotice } from "@/components/states";
import { sessionVariant } from "@/pages/TelemedicinePage";
import { useCountdown } from "@/hooks/useCountdown";
import { formatCountdown, formatDateTime, formatMinor } from "@/lib/format";
import { cn } from "@/lib/utils";

type Video = components["schemas"]["VideoTokenDto"];

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  return <span dir="ltr" className="kx-label-num">{formatCountdown(Math.max(0, now - new Date(since).getTime()))}</span>;
}

/** The mock video room (VIDEO_MODE=mock): no media leaves the browser. A real provider renders its own room `url` in an iframe. */
export function TeleRoomPage() {
  const { id = "" } = useParams();
  const { t } = useTranslation();
  const nav = useNavigate();
  const join = useJoinTeleSession();
  const end = useEndTeleSession();
  const [video, setVideo] = useState<Video | null>(null);
  const [session, setSession] = useState<TeleSession | null>(null);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [joined, setJoined] = useState(0);

  useEffect(() => {
    if (!id) return;
    join.mutate(id, { onSuccess: (r) => { setVideo(r.video); setSession(r.session); setJoined(Date.now()); } });
    // join once per mount; the API issues a fresh room token each call
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (join.isPending || (!video && !join.error)) return <LoadingState label={t("tele.joining")} />;
  if (join.error || !video) {
    const e = join.error;
    const msg = e instanceof ApiError ? (e.isFeatureDisabled ? t("unavailable.title") : e.status === 403 || e.status === 409 || e.status === 422 ? t("tele.errors.notOpen") : t("tele.errors.generic")) : t("tele.errors.generic");
    return <div className="space-y-4"><ErrorState error={e} onRetry={() => join.mutate(id, { onSuccess: (r) => { setVideo(r.video); setSession(r.session); } })} /><p className="text-center text-sm text-muted-foreground" role="status">{msg}</p><Link className="block text-center text-ocean underline" to={`/telemedicine/${id}`}>{t("tele.backToSession")}</Link></div>;
  }
  const mock = video.provider === "mock";
  return (
    <div className="mx-auto max-w-3xl space-y-4" data-testid="tele-room">
      {mock && <MockNotice kind="video" proven />}
      <div className={cn("relative flex aspect-video items-center justify-center overflow-hidden rounded-2xl bg-ink text-white")} data-testid="tele-stage">
        {mock || !video.url ? (
          <div className="space-y-2 text-center"><Video className="mx-auto h-12 w-12 opacity-70" aria-hidden="true" /><p className="font-semibold">{t("tele.roomMock")}</p><p className="text-sm opacity-80" dir="ltr">{video.room}</p></div>
        ) : <iframe src={video.url} title={t("tele.roomFrame")} allow="camera; microphone; fullscreen" className="h-full w-full border-0" />}
        <div className="absolute end-3 top-3 rounded-lg bg-black/50 px-3 py-1 text-sm" aria-live="off"><Elapsed since={new Date(joined || Date.now()).toISOString()} /></div>
        <div className="absolute bottom-3 start-3 rounded-lg bg-black/50 px-3 py-1 text-xs">{t("tele.you")} · {mic ? "" : t("tele.muted")}{cam ? "" : ` ${t("tele.camOff")}`}</div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3" role="toolbar" aria-label={t("tele.controls")}>
        <Button variant="outline" size="lg" aria-pressed={!mic} onClick={() => setMic((m) => !m)} data-testid="tele-mic">{mic ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}{mic ? t("tele.mute") : t("tele.unmute")}</Button>
        <Button variant="outline" size="lg" aria-pressed={!cam} onClick={() => setCam((c) => !c)} data-testid="tele-cam">{cam ? <Video aria-hidden="true" /> : <VideoOff aria-hidden="true" />}{cam ? t("tele.camOffAction") : t("tele.camOnAction")}</Button>
        <Button variant="destructive" size="lg" disabled={end.isPending} data-testid="tele-end" onClick={() => end.mutate(id, { onSuccess: () => { toast.success(t("tele.ended")); nav(`/telemedicine/${id}`, { replace: true }); }, onError: () => toast.error(t("tele.errors.generic")) })}><PhoneOff aria-hidden="true" />{t("tele.end")}</Button>
      </div>
      <p className="text-center text-xs text-muted-foreground">{session ? t("tele.consultFee", { fee: formatMinor(session.consultFeeMinor, "en") }) : null} {t("tele.privacy")}</p>
    </div>
  );
}

export default function TeleSessionPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const q = useTeleSession(id);
  const Back = i18n.language.startsWith("ar") ? ArrowRight : ArrowLeft;
  const opens = useCountdown(q.data && ["SCHEDULED", "WAITING"].includes(q.data.status) ? q.data.joinOpensAt : null);
  if (q.isLoading) return <LoadingState />;
  if (q.error) return q.error instanceof ApiError && q.error.status === 404 ? <EmptyState title={t("tele.notFound")} /> : <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data!;
  const open = opens.expired || (opens.remainingMs ?? 0) === 0;
  const joinable = ["SCHEDULED", "WAITING", "IN_PROGRESS"].includes(s.status);
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/telemedicine" className="inline-flex min-h-11 items-center gap-1 text-sm text-ocean"><Back className="h-4 w-4" aria-hidden="true" />{t("tele.title")}</Link>
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl">{t("tele.sessionTitle")}</h1><Badge variant={sessionVariant(s.status)} data-testid="tele-status">{t(`tele.status.${s.status}`)}</Badge></div>
      <div className="kx-card space-y-3 p-5">
        <p><b>{formatDateTime(s.scheduledStartsAt, i18n.language)}</b></p>
        {joinable && !open && <p className="text-sm text-muted-foreground" aria-live="polite" data-testid="tele-countdown">{t("tele.joinOpensIn")} <b dir="ltr" className="kx-label-num">{formatCountdown(opens.remainingMs ?? 0)}</b></p>}
        {s.status === "ENDED" && <p className="text-sm text-muted-foreground" data-testid="tele-ended">{t("tele.endedBody")}{s.durationSec != null ? ` ${t("tele.duration", { min: Math.max(1, Math.round(s.durationSec / 60)) })}` : ""}</p>}
        {s.status === "CANCELLED" && <p className="text-sm text-muted-foreground">{t("tele.cancelledBody")}</p>}
        {joinable && (open
          ? <Button size="lg" asChild><Link to={`/telemedicine/${s.id}/room`} data-testid="tele-join">{s.status === "IN_PROGRESS" ? t("tele.rejoin") : t("tele.join")}</Link></Button>
          : <Button size="lg" disabled data-testid="tele-join-disabled">{t("tele.join")}</Button>)}
      </div>
      <MockNotice kind="video" />
    </div>
  );
}
