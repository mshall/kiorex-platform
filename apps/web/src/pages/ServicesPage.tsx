import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BellRing, FlaskConical, MessageCircle, Pill, ShieldCheck, Video, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useFeature } from "@/hooks/useFeature";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/kit";

const WA = (import.meta.env.VITE_WHATSAPP_NUMBER as string | undefined)?.replace(/\D/g, "");

function Status({ flag }: { flag: string }) {
  const { t } = useTranslation();
  const f = useFeature(flag);
  if (f.isLoading) return null;
  return f.enabled ? <Badge variant="success">{t("services.available")}</Badge> : <Badge variant="warning" data-testid="svc-locked">{f.awaiting ? t("services.awaiting") : t("services.paused")}</Badge>;
}

function Card({ to, icon: Icon, title, body, flag, testId }: { to: string; icon: LucideIcon; title: string; body: string; flag?: string; testId: string }) {
  return (
    <Link to={to} className="kx-card flex flex-col gap-2 p-5 transition-colors hover:border-primary" data-testid={testId}>
      <div className="flex items-center justify-between"><Icon className="h-6 w-6 text-ocean" aria-hidden="true" />{flag && <Status flag={flag} />}</div>
      <h2 className="text-lg">{title}</h2><p className="text-sm text-muted-foreground">{body}</p>
    </Link>
  );
}

/** WhatsApp booking entry point (KXM-BK-11): information only; the conversation itself runs on WhatsApp, server-to-server. */
function WhatsAppCard() {
  const { t } = useTranslation();
  const f = useFeature("kiorex.whatsapp_booking");
  return (
    <section className={cn("kx-card space-y-3 p-5 sm:col-span-2")} aria-labelledby="wa-h" data-testid="whatsapp-card">
      <div className="flex items-center justify-between"><MessageCircle className="h-6 w-6 text-ocean" aria-hidden="true" />{f.enabled ? <Badge variant="success">{t("services.available")}</Badge> : <Badge variant="warning">{f.awaiting ? t("services.awaiting") : t("services.paused")}</Badge>}</div>
      <h2 id="wa-h" className="text-lg">{t("services.whatsapp.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("services.whatsapp.body")}</p>
      <ol className="list-decimal space-y-1 ps-5 text-sm"><li>{t("services.whatsapp.s1")}</li><li>{t("services.whatsapp.s2")}</li><li>{t("services.whatsapp.s3")}</li></ol>
      <p className="text-xs text-muted-foreground">{t("services.whatsapp.privacy")}</p>
      {f.enabled && (WA ? <a className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground" href={`https://wa.me/${WA}`} target="_blank" rel="noopener noreferrer" onClick={() => track("whatsapp_link_clicked")} data-testid="whatsapp-link">{t("services.whatsapp.open")}</a> : <p className="text-sm font-medium" data-testid="whatsapp-soon">{t("services.whatsapp.soon")}</p>)}
    </section>
  );
}

export default function ServicesPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      <PageHeader title={t("services.title")} />
      <p className="max-w-2xl text-muted-foreground">{t("services.intro")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card to="/pharmacy" icon={Pill} title={t("pharmacy.title")} body={t("services.pharmacy")} flag="kiorex.pharmacy_orders" testId="svc-pharmacy" />
        <Card to="/lab" icon={FlaskConical} title={t("lab.title")} body={t("services.lab")} flag="kiorex.lab_bookings" testId="svc-lab" />
        <Card to="/telemedicine" icon={Video} title={t("tele.title")} body={t("services.tele")} flag="kiorex.telemedicine" testId="svc-tele" />
        <Card to="/records" icon={ShieldCheck} title={t("records.title")} body={t("services.records")} flag="kiorex.record_vault" testId="svc-records" />
        <Card to="/waitlist" icon={BellRing} title={t("waitlist.title")} body={t("services.waitlist")} testId="svc-waitlist" />
        <WhatsAppCard />
      </div>
    </div>
  );
}
