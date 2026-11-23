import { useTranslation } from "react-i18next";
import { FileText, FlaskConical, Pill, Upload } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Lock } from "lucide-react";
import type { VaultItem } from "@/api/services";

export const KIND_ICON = { VISIT_SUMMARY: FileText, PRESCRIPTION: Pill, LAB_RESULT: FlaskConical, UPLOAD: Upload } as const;
export const kindIcon = (k: VaultItem["kind"]) => KIND_ICON[k];

/** kiorex.record_vault OFF: the vault stays readable and deletable, but uploads and new sharing are paused (ADR-023: OFF never hides data). */
export function ReadOnlyBanner() {
  const { t } = useTranslation();
  return (
    <Alert role="status" data-testid="vault-readonly">
      <Lock className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>{t("records.readOnlyTitle")}</AlertTitle>
      <AlertDescription>{t("records.readOnlyBody")}</AlertDescription>
    </Alert>
  );
}

/** Renders arbitrary clinical JSON (visit summary / lab report) without assuming a schema. Nothing here is logged or sent to analytics. */
const INTERNAL_KEY = /(^id$|Id$|Ids$|^secureLink$)/;
const humanize = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
export function JsonView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const { t } = useTranslation();
  if (value == null) return <span className="text-muted-foreground">—</span>;
  if (typeof value !== "object") return <span>{String(value)}</span>;
  if (depth > 4) return <span className="text-muted-foreground">…</span>;
  // internal identifiers (encounterId, orderId, ...) mean nothing to a patient and are never shown
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i + 1), v] as const) : Object.entries(value as Record<string, unknown>).filter(([k]) => !INTERNAL_KEY.test(k));
  return (
    <dl className="space-y-1.5 text-sm">
      {entries.map(([k, v]) => (
        <div key={k} className={depth ? "ps-3 border-s" : undefined}>
          <dt className="text-xs font-medium text-muted-foreground">{Array.isArray(value) ? `#${k}` : t(`records.field.${k}`, { defaultValue: humanize(k) })}</dt>
          <dd><JsonView value={v} depth={depth + 1} /></dd>
        </div>
      ))}
    </dl>
  );
}
