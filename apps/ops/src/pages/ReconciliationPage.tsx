import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, RefreshCw, Upload } from "lucide-react";
import { ApiError } from "@/api/errors";
import { rawApi, rawText } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CardSkeleton, ErrorState } from "@/components/states";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { formatDateTime, formatMinor } from "@/lib/format";

interface Run { id: string; status: "OK" | "DISCREPANCIES"; discrepancies: Array<{ type: string; ref: string; psp?: string; detail?: unknown }>; stats?: { date?: string; captured?: number }; createdAt: string }
interface Dispute { id: string; paymentId: string; psp: string; pspDisputeRef: string; state: "OPEN" | "WON" | "LOST"; amountMinor: number; currency: string; reasonCode: string | null; evidenceDueAt: string | null; openedAt: string }
interface Fileish { id: string; psp: string; filename: string; lineCount: number; rejected: number; importedAt: string }

/** PAY-READY: settlement reconciliation + disputes. Import a vendor report (CSV or JSON), run the daily reconcile, read the typed mismatches, download them as CSV, and see every dispute with its state. */
export default function ReconciliationPage() {
  const { t, i18n } = useTranslation(); const qc = useQueryClient(); const fileRef = useRef<HTMLInputElement>(null);
  const [psp, setPsp] = useState("paymob");
  const runs = useQuery({ queryKey: ["pay", "runs"], queryFn: () => rawApi<Run[]>("GET", "/admin/reconciliation/runs") });
  const disputes = useQuery({ queryKey: ["pay", "disputes"], queryFn: () => rawApi<Dispute[]>("GET", "/admin/payments/disputes") });
  const files = useQuery({ queryKey: ["pay", "files"], queryFn: () => rawApi<Fileish[]>("GET", "/admin/payments/settlement/files") });
  const inv = () => { void qc.invalidateQueries({ queryKey: ["pay"] }); };
  const run = useMutation({ mutationFn: () => rawApi<Run>("POST", "/admin/reconciliation/psp/run"), onSuccess: (r) => { toast.success(t(r.status === "OK" ? "recon.runOk" : "recon.runDiscrepancies", { n: r.discrepancies.length })); inv(); } });
  const poll = useMutation({ mutationFn: () => rawApi<{ checked: number; changed: number }>("POST", "/admin/payments/poll"), onSuccess: (r) => { toast.success(t("recon.polled", { checked: r.checked, changed: r.changed })); inv(); } });
  const imp = useMutation({
    mutationFn: async (f: File) => rawApi<{ imported: number; duplicate: boolean; rejected: unknown[] }>("POST", "/admin/payments/settlement/import", { psp, filename: f.name, content: await f.text() }),
    onSuccess: (r) => { toast.success(r.duplicate ? t("recon.duplicate") : t("recon.imported", { n: r.imported, bad: r.rejected.length })); inv(); },
    onError: (e) => toast.error(e instanceof ApiError ? `${e.code}: ${e.message}` : t("states.errorTitle")),
  });
  const download = async (id: string) => { const csv = await rawText(`/admin/payments/reconciliation/${id}/mismatches.csv`); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `mismatches-${id}.csv`; a.click(); URL.revokeObjectURL(a.href); };
  const last = runs.data?.[0];
  return (
    <div>
      <PageHeader title={t("recon.title")} hint={t("recon.hint")} actions={<><Button variant="outline" onClick={() => poll.mutate()} disabled={poll.isPending} data-testid="poll"><RefreshCw aria-hidden="true" />{t("recon.poll")}</Button><Button onClick={() => run.mutate()} disabled={run.isPending} data-testid="run"><RefreshCw aria-hidden="true" />{t("recon.run")}</Button></>} />
      <section aria-labelledby="rc-import" className="mb-6 rounded-xl border bg-card p-4 shadow-card">
        <h2 id="rc-import" className="text-base font-semibold">{t("recon.import")}</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div><Label htmlFor="rc-psp">{t("recon.psp")}</Label><select id="rc-psp" className="mt-1 h-11 rounded-xl border bg-background px-3 text-sm" value={psp} onChange={(e) => setPsp(e.target.value)}>{["paymob", "fawry", "instapay", "card"].map((p) => <option key={p} value={p}>{t(`payconn.names.${p}`)}</option>)}</select></div>
          <div><Label htmlFor="rc-file">{t("recon.file")}</Label><input id="rc-file" ref={fileRef} type="file" accept=".csv,.json,text/csv,application/json" className="mt-1 block h-11 text-sm" data-testid="file" /></div>
          <Button onClick={() => { const f = fileRef.current?.files?.[0]; if (f) imp.mutate(f); else toast.error(t("recon.pickFile")); }} disabled={imp.isPending} data-testid="import"><Upload aria-hidden="true" />{t("recon.importBtn")}</Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("recon.importHint")}</p>
        {files.data && files.data.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{t("recon.lastFile", { name: files.data[0].filename, n: files.data[0].lineCount, bad: files.data[0].rejected })}</p>}
      </section>
      <h2 className="mb-2 text-base font-semibold">{t("recon.runs")}</h2>
      {runs.isLoading ? <CardSkeleton rows={2} /> : runs.error ? <ErrorState error={runs.error} onRetry={() => void runs.refetch()} /> : (
        <DataTable caption={t("recon.runs")} rows={runs.data!} rowKey={(r) => r.id} empty={t("recon.noRuns")} columns={[
          { key: "d", header: t("recon.date"), cell: (r) => <span className="whitespace-nowrap">{r.stats?.date ?? formatDateTime(r.createdAt, i18n.language)}</span> },
          { key: "s", header: t("recon.status"), cell: (r) => <Badge variant={r.status === "OK" ? "success" : "warning"}>{t(`recon.statuses.${r.status}`)}</Badge> },
          { key: "n", header: t("recon.mismatches"), cell: (r) => r.discrepancies.length },
          { key: "t", header: t("recon.types"), cell: (r) => [...new Set(r.discrepancies.map((d) => d.type))].slice(0, 4).join(", ") || "-" },
          { key: "x", header: "", cell: (r) => r.discrepancies.length ? <Button size="sm" variant="outline" onClick={() => void download(r.id)} data-testid={`csv-${r.id}`}><Download aria-hidden="true" />{t("recon.csv")}</Button> : null },
        ]} />
      )}
      {last && last.discrepancies.length > 0 && <div className="mt-4"><DataTable caption={t("recon.latestMismatches")} rows={last.discrepancies.slice(0, 100)} rowKey={(d) => `${d.type}:${d.ref}`} empty="" columns={[
        { key: "t", header: t("recon.type"), cell: (d) => <Badge variant="warning">{d.type}</Badge> }, { key: "p", header: t("recon.psp"), cell: (d) => d.psp ?? "-" }, { key: "r", header: t("recon.ref"), cell: (d) => <code dir="ltr" className="text-xs">{d.ref}</code> },
      ]} /></div>}
      <h2 className="mb-2 mt-8 text-base font-semibold">{t("recon.disputes")}</h2>
      {disputes.isLoading ? <CardSkeleton rows={2} /> : disputes.error ? <ErrorState error={disputes.error} onRetry={() => void disputes.refetch()} /> : (
        <DataTable caption={t("recon.disputes")} rows={disputes.data!} rowKey={(d) => d.id} empty={t("recon.noDisputes")} columns={[
          { key: "p", header: t("recon.payment"), cell: (d) => <code dir="ltr" className="text-xs">{d.paymentId}</code> },
          { key: "s", header: t("recon.status"), cell: (d) => <Badge variant={d.state === "OPEN" ? "warning" : d.state === "WON" ? "success" : "destructive"}>{t(`recon.dstates.${d.state}`)}</Badge> },
          { key: "a", header: t("recon.amount"), cell: (d) => <b className="kx-label-num">{formatMinor(d.amountMinor, i18n.language, d.currency)}</b> },
          { key: "r", header: t("recon.reason"), cell: (d) => d.reasonCode ?? "-" },
          { key: "e", header: t("recon.due"), cell: (d) => (d.evidenceDueAt ? formatDateTime(d.evidenceDueAt, i18n.language) : "-") },
        ]} />
      )}
    </div>
  );
}
