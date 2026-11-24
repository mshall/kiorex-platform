import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Copy, MessageCircle, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCreateInvite, type ReferralMe } from "@/api/referral";
import { InviteQr } from "./InviteQr";

const buzz = () => { try { navigator.vibrate?.(12); } catch { /* not supported */ } };

/** Invite link, code, share sheet, copy and WhatsApp. Each share asks the API for a share event (no contact data is ever sent). */
export function InviteShare({ me, offline }: { me: ReferralMe; offline?: boolean }) {
  const { t, i18n } = useTranslation(); const create = useCreateInvite(); const [copied, setCopied] = useState(false);
  const locale = i18n.language.startsWith("ar") ? "ar" : "en";
  const url = me.inviteUrl ?? "";
  const disabled = me.status !== "ACTIVE" || !url;
  const record = async (channel: "LINK" | "WHATSAPP_SHARE" | "COPY") => { if (offline) return null; try { return await create.mutateAsync({ channel, locale }); } catch { return null; } };
  const text = async (channel: "LINK" | "WHATSAPP_SHARE" | "COPY") => (await record(channel))?.shareText ?? t("referral.shareText", { url });
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); buzz(); toast.success(t("referral.copied")); setTimeout(() => setCopied(false), 2500); void record("COPY"); } catch { toast.error(t("referral.copyFailed")); } };
  const share = async () => { const msg = await text("LINK"); try { if (navigator.share) { await navigator.share({ text: msg }); buzz(); } else await copy(); } catch { /* the person closed the sheet */ } };
  const wa = async () => { const msg = await text("WHATSAPP_SHARE"); buzz(); window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer"); };
  return (
    <section className="kx-card grid gap-5 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-6" aria-labelledby="invite-title" data-testid="invite-card">
      <div className="min-w-0 space-y-4">
        <div><h2 id="invite-title" className="text-lg">{t("referral.inviteTitle")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("referral.inviteHint")}</p></div>
        <div>
          <p className="text-sm text-muted-foreground">{t("referral.yourCode")}</p>
          <p className="kx-label-num text-3xl font-semibold tracking-[0.25em]" data-testid="invite-code"><bdi dir="ltr">{me.code}</bdi></p>
        </div>
        <div>
          <label htmlFor="invite-link" className="text-sm text-muted-foreground">{t("referral.yourLink")}</label>
          <input id="invite-link" readOnly dir="ltr" value={url} onFocus={(e) => e.currentTarget.select()} className="mt-1 h-11 w-full rounded-xl border bg-muted/40 px-3 text-sm" data-testid="invite-link" />
        </div>
        {me.status !== "ACTIVE" && <p role="status" className="rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm text-warning" data-testid="invite-suspended">{t("referral.suspended")}</p>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void share()} disabled={disabled} data-testid="invite-share"><Share2 aria-hidden="true" />{t("referral.share")}</Button>
          <Button variant="outline" onClick={() => void copy()} disabled={disabled} data-testid="invite-copy"><Copy aria-hidden="true" />{copied ? t("referral.copiedShort") : t("referral.copy")}</Button>
          <Button variant="outline" onClick={() => void wa()} disabled={disabled} data-testid="invite-whatsapp"><MessageCircle aria-hidden="true" />{t("referral.whatsapp")}</Button>
        </div>
      </div>
      {url && <div className="flex flex-col items-center gap-2"><InviteQr value={url} /><p className="max-w-[10.5rem] text-center text-xs text-muted-foreground">{t("referral.qrHint")}</p></div>}
    </section>
  );
}
