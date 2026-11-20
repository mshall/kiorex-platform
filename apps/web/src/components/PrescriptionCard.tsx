import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Pill } from "lucide-react";
import { useVaultItem, type VaultItem } from "@/api/services";
import { QrImage } from "@/components/QrImage";
import { formatDate } from "@/lib/format";

type RxItem = { name?: string; drug?: string; dose?: string; dosage?: string; frequency?: string; duration?: string; strength?: string; instructions?: string };

/** One prescription with its verification QR (KXM-RC-02). The QR carries only an opaque signed token; a pharmacist verifies it via GET /rx/verify. */
export function PrescriptionCard({ item, standalone = false }: { item: VaultItem; standalone?: boolean }) {
  const { t, i18n } = useTranslation();
  const d = useVaultItem(item.id);
  const rx = (d.data?.prescription ?? {}) as { items?: RxItem[] | null; itemsAvailable?: boolean };
  return (
    <article className="kx-card flex flex-col gap-5 p-5 sm:flex-row" data-testid="rx-card">
      <div className="flex shrink-0 flex-col items-center gap-2">
        {d.data?.verification ? <QrImage value={d.data.verification.qrPayload} /> : <div className="h-48 w-48 animate-pulse rounded-lg bg-muted" aria-hidden="true" />}
        <p className="max-w-48 text-center text-xs text-muted-foreground">{t("records.qrHint")}</p>
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex items-center gap-2"><Pill className="h-5 w-5 text-ocean" aria-hidden="true" />
          <h3 className="text-lg">{standalone ? (item.title ?? t("records.kind.PRESCRIPTION")) : <Link className="hover:underline" to={`/records/${item.id}`}>{item.title ?? t("records.kind.PRESCRIPTION")}</Link>}</h3></div>
        <p className="text-sm text-muted-foreground">{t("records.signed", { date: formatDate(item.signedAt ?? item.createdAt, i18n.language) })}</p>
        {Array.isArray(rx.items) && rx.items.length > 0 ? (
          <ul className="space-y-2" data-testid="rx-items">
            {rx.items.map((m, i) => (
              <li key={i} className="rounded-lg bg-muted px-3 py-2 text-sm"><b>{m.name ?? m.drug ?? "—"}</b>{[m.strength, m.dose ?? m.dosage, m.frequency, m.duration].filter(Boolean).length > 0 && <span className="text-muted-foreground"> · {[m.strength, m.dose ?? m.dosage, m.frequency, m.duration].filter(Boolean).join(" · ")}</span>}{m.instructions && <p className="text-muted-foreground">{m.instructions}</p>}</li>
            ))}
          </ul>
        ) : d.data ? <p className="text-sm text-muted-foreground" data-testid="rx-no-items">{t("records.rxNoItems")}</p> : null}
        {d.error && <p role="alert" className="text-sm text-destructive">{t("states.errorBody")}</p>}
      </div>
    </article>
  );
}
