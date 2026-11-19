import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFeeStatement } from "@/api/ops";
import { CardSkeleton, ErrorState } from "@/components/states";
import { DataTable } from "@/components/DataTable";
import { PageHeader, StatTile } from "@/components/PageHeader";
import { formatBps, formatDateTime, formatMinor, toCsv } from "@/lib/format";

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Kiorex's own marketplace fee statement per partner. The VAT line is plain configuration (FEE_STATEMENT_VAT_BPS); this is an export for the accountant, nothing is submitted anywhere. */
export default function FeesPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [from, setFrom] = useState(() => day(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(() => day(new Date()));
  const q = useFeeStatement(from ? `${from}T00:00:00.000Z` : "", to ? `${to}T23:59:59.999Z` : "");
  const exportCsv = () => {
    const s = q.data; if (!s) return;
    const rows: (string | number)[][] = [[t("fees.partner"), t("fees.orders"), t("fees.fee"), t("fees.vatRate"), t("fees.vat"), t("fees.total")], ...s.lines.map((l) => [l.partner, l.orders, l.feeMinor / 100, l.vatBps / 100, l.vatMinor / 100, l.totalMinor / 100]), [t("fees.totals"), "", s.totals.feeMinor / 100, "", s.totals.vatMinor / 100, s.totals.totalMinor / 100]];
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `kiorex-fee-statement-${from}-${to}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div>
      <PageHeader title={t("fees.title")} hint={t("fees.hint")} actions={<Button variant="outline" disabled={!q.data || q.data.lines.length === 0} onClick={exportCsv} data-testid="export-fees"><Download aria-hidden="true" />{t("fees.export")}</Button>} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label htmlFor="fee-from">{t("fees.from")}</Label><Input id="fee-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-44" /></div>
        <div className="space-y-1"><Label htmlFor="fee-to">{t("fees.to")}</Label><Input id="fee-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-44" /></div>
      </div>
      {q.isLoading ? <CardSkeleton rows={1} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (<>
        <div className="mb-4 grid gap-3 sm:grid-cols-3" data-testid="fee-tiles">
          <StatTile label={t("fees.fee")} value={formatMinor(q.data!.totals.feeMinor, lang, q.data!.currency)} />
          <StatTile label={`${t("fees.vat")} (${formatBps(q.data!.vatBps, lang)})`} value={formatMinor(q.data!.totals.vatMinor, lang, q.data!.currency)} />
          <StatTile label={t("fees.total")} value={formatMinor(q.data!.totals.totalMinor, lang, q.data!.currency)} tone="ok" />
        </div>
        <p className="mb-3 text-sm text-muted-foreground" data-testid="vat-note">{q.data!.vatNote} · {formatDateTime(q.data!.from, lang)} – {formatDateTime(q.data!.to, lang)}</p>
        <DataTable caption={t("fees.title")} rows={q.data!.lines} rowKey={(l) => l.partner} empty={t("fees.empty")} columns={[
          { key: "p", header: t("fees.partner"), cell: (l) => <span className="font-medium">{t(`fees.partnerName.${l.partner}`, { defaultValue: l.partner })}</span> },
          { key: "o", header: t("fees.orders"), cell: (l) => l.orders }, { key: "f", header: t("fees.fee"), cell: (l) => formatMinor(l.feeMinor, lang, q.data!.currency) },
          { key: "vr", header: t("fees.vatRate"), cell: (l) => formatBps(l.vatBps, lang) }, { key: "v", header: t("fees.vat"), cell: (l) => formatMinor(l.vatMinor, lang, q.data!.currency) },
          { key: "t", header: t("fees.total"), cell: (l) => <b>{formatMinor(l.totalMinor, lang, q.data!.currency)}</b> },
        ]} />
      </>)}
    </div>
  );
}
