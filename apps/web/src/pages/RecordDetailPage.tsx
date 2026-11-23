import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Download, ExternalLink, FlaskConical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/api/errors";
import { downloadVaultFile, useDeleteVaultItem, useVaultItem } from "@/api/services";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { JsonView } from "@/components/VaultBits";
import { PrescriptionCard } from "@/components/PrescriptionCard";
import { formatBytes, formatDate } from "@/lib/format";
import { saveBlob } from "@/lib/download";

/** A lab result lives at the lab: Kiorex stores only the signed-report pointer, never values (KLCRIT03). The patient opens it through the lab's secure link. */
function LabResultCard({ report }: { report: Record<string, unknown> | null | undefined }) {
  const { t } = useTranslation();
  if (!report) return <div className="kx-card p-5" data-testid="record-content"><p className="text-muted-foreground">{t("records.noContent")}</p></div>;
  const link = typeof report.secureLink === "string" && /^https?:\/\//i.test(report.secureLink) ? report.secureLink : null;
  const version = typeof report.reportVersion === "number" ? report.reportVersion : null;
  return (
    <div className="kx-card space-y-3 p-5" data-testid="record-content">
      <div className="flex items-center gap-3"><FlaskConical className="h-6 w-6 text-ocean" aria-hidden="true" /><div><p className="font-semibold">{t("records.lab.ready")}</p>{version != null && <p className="text-xs text-muted-foreground">{t("records.lab.version", { n: version })}</p>}</div></div>
      <p className="text-sm text-muted-foreground">{t("records.lab.hint")}</p>
      {link ? <Button asChild data-testid="lab-secure-link"><a href={link} target="_blank" rel="noopener noreferrer"><ExternalLink className="rtl-flip" aria-hidden="true" />{t("records.lab.open")}</a></Button> : <p className="text-sm">{t("records.lab.noLink")}</p>}
    </div>
  );
}

export default function RecordDetailPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const q = useVaultItem(id);
  const del = useDeleteVaultItem();
  const Back = i18n.language.startsWith("ar") ? ArrowRight : ArrowLeft;
  if (q.isLoading) return <LoadingState />;
  if (q.error) return q.error instanceof ApiError && q.error.status === 404 ? <EmptyState title={t("records.notFound")} action={<Link to="/records" className="text-ocean underline">{t("records.back")}</Link>} /> : <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data!;
  const download = async () => {
    try { saveBlob(await downloadVaultFile(r.id), r.fileName ?? "record"); } catch { toast.error(t("records.errors.generic")); }
  };
  return (
    <div className="space-y-5">
      <Link to="/records" className="inline-flex min-h-11 items-center gap-1 text-sm text-ocean"><Back className="h-4 w-4" aria-hidden="true" />{t("records.back")}</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl" data-testid="record-title">{r.kind === "LAB_RESULT" && (!r.title || /^lab report$/i.test(r.title)) ? t("records.kind.LAB_RESULT") : r.title ?? t(`records.kind.${r.kind}`)}</h1><p className="text-sm text-muted-foreground">{t(`records.kind.${r.kind}`)} · {t(`records.source.${r.source}`)} · {formatDate(r.signedAt ?? r.createdAt, i18n.language)}</p></div>
        <Button variant="outline" onClick={() => del.mutate(r.id, { onSuccess: () => { toast.success(t("records.deleted")); nav("/records"); }, onError: () => toast.error(t("records.errors.generic")) })} disabled={del.isPending}><Trash2 aria-hidden="true" />{t("records.delete")}</Button>
      </div>
      {r.kind === "PRESCRIPTION" && <PrescriptionCard item={r} standalone />}
      {r.kind === "UPLOAD" && r.hasFile && (
        <div className="kx-card flex flex-wrap items-center justify-between gap-3 p-5"><div><p className="font-medium">{r.fileName}</p><p className="text-sm text-muted-foreground">{r.mimeType}{r.sizeBytes ? ` · ${formatBytes(r.sizeBytes, i18n.language)}` : ""}</p></div><Button onClick={() => void download()} data-testid="record-download"><Download aria-hidden="true" />{t("records.download")}</Button></div>
      )}
      {r.kind === "VISIT_SUMMARY" && <div className="kx-card p-5" data-testid="record-content">{r.content ? <JsonView value={r.content} /> : <p className="text-muted-foreground">{t("records.noContent")}</p>}</div>}
      {r.kind === "LAB_RESULT" && <LabResultCard report={r.report as Record<string, unknown> | null | undefined} />}
    </div>
  );
}
