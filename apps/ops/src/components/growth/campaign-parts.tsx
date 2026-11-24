import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { StatusChip, type Tone } from "@/components/kit";
import { ApiError } from "@/api/errors";
import { formatMinor } from "@/lib/format";
import type { CampaignStatus } from "@/api/campaigns";

const TONE: Record<CampaignStatus, Tone> = { DRAFT: "neutral", PENDING_APPROVAL: "warning", SCHEDULED: "info", ACTIVE: "success", PAUSED: "warning", COMPLETED: "brand", ARCHIVED: "neutral" };

export function CampaignStatusChip({ status }: { status: CampaignStatus }) {
  const { t } = useTranslation();
  return <StatusChip tone={TONE[status]} data-testid="campaign-status" data-status={status}>{t(`growth.campaigns.status.${status}`)}</StatusChip>;
}

/** Minor units as money in the page language (Arabic-Indic digits in Arabic). */
export const useMoney = () => { const { i18n } = useTranslation(); return (minor: number, currency = "EGP") => formatMinor(minor, i18n.language, currency); };

/** Utilisation bar: role=meter with a readable value, not colour alone. */
export function BudgetMeter({ bp, label }: { bp: number; label: ReactNode }) {
  const { t, i18n } = useTranslation(); const pct = Math.min(100, bp / 100);
  const txt = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(pct) + "%";
  const tone = bp >= 10_000 ? "bg-destructive" : bp >= 8_000 ? "bg-warning" : "bg-primary";
  return (
    <div data-testid="budget-meter" data-bp={bp}>
      <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{label}</span><span>{t("growth.campaigns.list.utilisation", { pct: txt })}</span></div>
      <div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={String(label)} className="mt-1 h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/** A server error as a sentence: the campaign codes have their own copy; field errors of CAMPAIGN_INVALID are listed. */
export function useErrorText() {
  const { t } = useTranslation();
  return (e: unknown): string => {
    if (e instanceof ApiError) {
      if (e.isFeatureDisabled) return t("growth.campaigns.err.FEATURE_DISABLED");
      const known = t(`growth.campaigns.err.${e.code}`, { defaultValue: "" });
      const fields = Array.isArray((e.details as { errors?: unknown } | undefined)?.errors) ? ((e.details as { errors: Array<{ message?: string } | string> }).errors).map((x) => (typeof x === "string" ? x : x.message)).filter(Boolean).join(" ") : "";
      return [known || e.message, fields].filter(Boolean).join(" ");
    }
    return t("growth.campaigns.err.generic");
  };
}

export const toMinor = (egp: string) => Math.round(Number(egp.replace(/[^\d.]/g, "")) * 100);
export const fromMinor = (m: number) => (m / 100).toString();
