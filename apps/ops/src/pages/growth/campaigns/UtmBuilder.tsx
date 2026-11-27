import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { FormField } from "@/components/kit";
import { SITE_CANONICAL_HOST } from "@/lib/hosts";

export interface UtmForm { source: string; medium: string; content: string; term: string; targetPath: string }
const TOKEN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const MEDIUM: Record<string, string> = { ORGANIC_SEARCH: "organic", EMAIL: "email", SMS: "sms", WHATSAPP: "whatsapp", PUSH: "push", IN_APP: "in_app", PARTNER: "partner", PAID_SEARCH: "cpc", PAID_SOCIAL: "paid_social", PAID_VIDEO: "paid_video", OFFLINE: "offline", REFERRAL: "referral" };

/** Mirror of the server builder (campaign-utm.ts) so the preview is instant; the server stays the authority and returns the real links after the draft exists. */
export function previewLinks(i: { market: string; key: string; channels: string[]; form: UtmForm; host?: string; locale?: string }) {
  const utm: Record<string, string> = { utm_source: i.form.source || "kiorex", utm_medium: i.form.medium || MEDIUM[i.channels[0] ?? ""] || "campaign", utm_campaign: `${i.market.toLowerCase()}-${i.key || "key"}` };
  if (i.form.content) utm.utm_content = i.form.content; if (i.form.term) utm.utm_term = i.form.term;
  const path = `/${i.locale ?? "ar"}/${i.market.toLowerCase()}${i.form.targetPath || ""}`;
  return { utm, url: `${(i.host ?? SITE_CANONICAL_HOST).replace(/\/+$/, "")}${path}?${new URLSearchParams(utm).toString()}` };
}
export const utmErrors = (f: UtmForm): Partial<Record<keyof UtmForm, boolean>> => ({
  source: !!f.source && !TOKEN.test(f.source), medium: !!f.medium && !TOKEN.test(f.medium), content: !!f.content && !TOKEN.test(f.content), term: !!f.term && !TOKEN.test(f.term),
  targetPath: !!f.targetPath && !/^\/[A-Za-z0-9/_.~%-]{0,200}$/.test(f.targetPath),
});

export function UtmBuilder({ value, onChange, market, keyValue, channels }: { value: UtmForm; onChange: (v: UtmForm) => void; market: string; keyValue: string; channels: string[] }) {
  const { t } = useTranslation(); const err = utmErrors(value); const p = previewLinks({ market, key: keyValue, channels, form: value });
  const set = (k: keyof UtmForm) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  const bad = t("growth.campaigns.wizard.keyHint");
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast.success(t("growth.campaigns.wizard.copied")); } catch { /* clipboard blocked: the text is selectable */ } };
  return (
    <div className="space-y-4" data-testid="utm-builder">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("growth.campaigns.wizard.source")} error={err.source ? bad : undefined}><input className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm" dir="ltr" value={value.source} onChange={set("source")} placeholder="kiorex" data-testid="utm-source" /></FormField>
        <FormField label={t("growth.campaigns.wizard.medium")} error={err.medium ? bad : undefined}><input className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm" dir="ltr" value={value.medium} onChange={set("medium")} placeholder={MEDIUM[channels[0] ?? ""] ?? "campaign"} data-testid="utm-medium" /></FormField>
        <FormField label={t("growth.campaigns.wizard.content")} error={err.content ? bad : undefined}><input className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm" dir="ltr" value={value.content} onChange={set("content")} data-testid="utm-content" /></FormField>
        <FormField label={t("growth.campaigns.wizard.term")} error={err.term ? bad : undefined}><input className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm" dir="ltr" value={value.term} onChange={set("term")} data-testid="utm-term" /></FormField>
        <FormField label={t("growth.campaigns.wizard.targetPath")} hint={t("growth.campaigns.wizard.targetHint")} error={err.targetPath ? t("growth.campaigns.wizard.targetHint") : undefined} className="sm:col-span-2"><input className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm" dir="ltr" value={value.targetPath} onChange={set("targetPath")} placeholder="/doctors" data-testid="utm-path" /></FormField>
      </div>
      <div className="rounded-xl border bg-muted/40 p-3 text-sm" data-testid="utm-preview">
        <p className="font-medium">{t("growth.campaigns.wizard.preview")}</p>
        <p className="mt-1 text-muted-foreground">{t("growth.campaigns.wizard.campaignTag")}: <code dir="ltr" data-testid="utm-tag">{p.utm.utm_campaign}</code></p>
        <div className="mt-2 flex items-start gap-2"><code dir="ltr" className="min-w-0 flex-1 break-all text-xs" data-testid="utm-url">{p.url}</code><button type="button" className="inline-flex h-9 min-w-11 items-center justify-center gap-1 rounded-lg border px-2 text-xs font-semibold hover:bg-accent" onClick={() => void copy(p.url)}><Copy className="h-3.5 w-3.5" aria-hidden="true" />{t("growth.campaigns.wizard.copy")}</button></div>
      </div>
    </div>
  );
}
