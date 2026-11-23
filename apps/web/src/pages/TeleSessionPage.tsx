import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, CheckCircle2, Lightbulb, Mic, MicOff, PhoneOff, ShieldCheck, Video, VideoOff, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/api/errors";
import { useEndTeleSession, useJoinTeleSession, useTeleSession, type TeleSession } from "@/api/services";
import type { components } from "@/api/schema";
import { EmptyState, ErrorState, LoadingState, MockNotice } from "@/components/states";
import { sessionTone } from "@/pages/TelemedicinePage";
import { StatusChip } from "@/components/kit";
import { DateBlock } from "@/components/AppointmentTicket";
import { LogoMark } from "@/components/Logo";
import { useCountdown } from "@/hooks/useCountdown";
import { formatCountdown, formatDateTime, formatMinor } from "@/lib/format";

type Video = components["schemas"]["VideoTokenDto"];

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  return <span dir="ltr" className="kx-label-num">{formatCountdown(Math.max(0, now - new Date(since).getTime()))}</span>;
}

/** The mock video room (VIDEO_MODE=mock): no media leaves the browser. A real provider renders its own room `url` in an iframe. */
export function TeleRoomPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
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
    // a closed / ended / not-yet-open room is an expected answer, not a failure: say so plainly instead of a generic "something went wrong" card
    if (e instanceof ApiError && !e.isFeatureDisabled && (e.status === 403 || e.status === 409 || e.status === 422)) return <div className="mx-auto max-w-md space-y-4 py-10 text-center" data-testid="tele-not-open"><p className="text-lg font-semibold" role="status">{msg}</p><Link className="inline-flex min-h-11 items-center text-ocean underline" to={`/telemedicine/${id}`}>{t("tele.backToSession")}</Link></div>;
    return <div className="space-y-4"><ErrorState error={e} onRetry={() => join.mutate(id, { onSuccess: (r) => { setVideo(r.video); setSession(r.session); setJoined(Date.now()); } })} /><p className="text-center text-sm text-muted-foreground" role="status">{msg}</p><Link className="block text-center text-ocean underline" to={`/telemedicine/${id}`}>{t("tele.backToSession")}</Link></div>;
  }
  const mock = video.provider === "mock";
  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="tele-room">
      {mock && <MockNotice kind="video" proven />}
      <div className="relative flex aspect-4/5 items-center justify-center overflow-hidden rounded-3xl bg-[#0C0D1F] text-white shadow-float sm:aspect-video" data-testid="tele-stage">
        {mock || !video.url ? (
          <>
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,hsl(var(--primary)/0.55),transparent_60%),radial-gradient(ellipse_at_80%_90%,hsl(var(--ocean)/0.45),transparent_55%)]" aria-hidden="true" />
            <div className="relative flex flex-col items-center gap-4 text-center">
              <span className="flex h-24 w-24 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20 backdrop-blur-sm"><LogoMark className="h-12 [&_svg]:text-white" /></span>
              <div className="space-y-1"><p className="text-lg font-semibold">{t("tele.roomMock")}</p><p className="text-sm text-white/70" dir="ltr">{video.room}</p></div>
              <svg viewBox="0 0 240 24" className="h-6 w-40" aria-hidden="true"><path d="M0 12 H90 l6 -8 l7 16 l8 -22 l8 20 l4 -6 H240" fill="none" className="stroke-pulse animate-pulseline" strokeWidth="2.5" strokeDasharray="200" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
          </>
        ) : <iframe src={video.url} title={t("tele.roomFrame")} allow="camera; microphone; fullscreen" className="h-full w-full border-0" />}
        <div className="absolute inset-e-3 top-3 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-sm backdrop-blur-sm" aria-live="off"><span className="h-2 w-2 rounded-full bg-success animate-pulse motion-reduce:animate-none" aria-hidden="true" /><Elapsed since={new Date(joined).toISOString()} /></div>
        <div className="absolute bottom-3 inset-e-3 flex h-24 w-20 flex-col items-center justify-center gap-1 rounded-2xl border border-white/20 bg-white/10 text-xs backdrop-blur-sm sm:h-28 sm:w-36" data-testid="tele-self">
          {cam ? <Video className="h-5 w-5 opacity-80" aria-hidden="true" /> : <VideoOff className="h-5 w-5 opacity-80" aria-hidden="true" />}<span>{t("tele.you")}{mic ? "" : ` · ${t("tele.muted")}`}{cam ? "" : ` · ${t("tele.camOff")}`}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3" role="toolbar" aria-label={t("tele.controls")}>
        <Button variant={mic ? "outline" : "secondary"} size="lg" className="rounded-full" aria-pressed={!mic} onClick={() => setMic((m) => !m)} data-testid="tele-mic">{mic ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}{mic ? t("tele.mute") : t("tele.unmute")}</Button>
        <Button variant={cam ? "outline" : "secondary"} size="lg" className="rounded-full" aria-pressed={!cam} onClick={() => setCam((c) => !c)} data-testid="tele-cam">{cam ? <Video aria-hidden="true" /> : <VideoOff aria-hidden="true" />}{cam ? t("tele.camOffAction") : t("tele.camOnAction")}</Button>
        <Button variant="destructive" size="lg" className="rounded-full" disabled={end.isPending} data-testid="tele-end" onClick={() => end.mutate(id, { onSuccess: () => { toast.success(t("tele.ended")); nav(`/telemedicine/${id}`, { replace: true }); }, onError: () => toast.error(t("tele.errors.generic")) })}><PhoneOff aria-hidden="true" />{t("tele.end")}</Button>
      </div>
      <p className="text-center text-xs text-muted-foreground">{session && session.consultFeeMinor > 0 ? t("tele.consultFee", { fee: formatMinor(session.consultFeeMinor, i18n.language) }) : null} {t("tele.privacy")}</p>
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
      <header className="kx-card flex items-center gap-4 p-5">
        <DateBlock iso={s.scheduledStartsAt} />
        <div className="min-w-0 flex-1"><h1 className="text-xl md:text-2xl">{t("tele.sessionTitle")}</h1><p className="text-sm text-muted-foreground">{formatDateTime(s.scheduledStartsAt, i18n.language)}</p></div>
        <StatusChip tone={sessionTone(s.status)} data-testid="tele-status">{t(`tele.status.${s.status}`)}</StatusChip>
      </header>
      <div className="kx-card space-y-4 p-5 sm:p-6">
        {joinable && !open && (
          <div className="flex flex-col items-center gap-1 rounded-2xl bg-accent/60 py-6 text-center" aria-live="polite" data-testid="tele-countdown">
            <p className="text-sm text-muted-foreground">{t("tele.joinOpensIn")}</p>
            <p className="kx-label-num text-4xl font-semibold" dir="ltr">{formatCountdown(opens.remainingMs ?? 0)}</p>
          </div>
        )}
        {s.status === "ENDED" && <div className="flex items-center gap-3 rounded-2xl bg-muted/60 p-4 text-sm" data-testid="tele-ended"><CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" /><p>{t("tele.endedBody")}{s.durationSec != null ? ` ${t("tele.duration", { min: Math.max(1, Math.round(s.durationSec / 60)) })}` : ""}</p></div>}
        {s.status === "CANCELLED" && <p className="text-sm text-muted-foreground">{t("tele.cancelledBody")}</p>}
        {joinable && (open
          ? <Button size="lg" className="w-full sm:w-auto" asChild><Link to={`/telemedicine/${s.id}/room`} data-testid="tele-join"><Video aria-hidden="true" />{s.status === "IN_PROGRESS" ? t("tele.rejoin") : t("tele.join")}</Link></Button>
          : <Button size="lg" className="w-full sm:w-auto" disabled data-testid="tele-join-disabled"><Video aria-hidden="true" />{t("tele.join")}</Button>)}
      </div>
      {joinable && (
        <section className="kx-card space-y-3 p-5" aria-labelledby="prep-h">
          <h2 id="prep-h" className="text-lg">{t("tele.prepTitle")}</h2>
          <ul className="grid gap-3 text-sm sm:grid-cols-3">
            {([[Wifi, "prep1"], [Lightbulb, "prep2"], [ShieldCheck, "prep3"]] as const).map(([Icon, k]) => <li key={k} className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-primary" aria-hidden="true"><Icon className="h-[18px] w-[18px]" /></span><span className="pt-1 text-muted-foreground">{t(`tele.${k}`)}</span></li>)}
          </ul>
        </section>
      )}
      <MockNotice kind="video" />
    </div>
  );
}
