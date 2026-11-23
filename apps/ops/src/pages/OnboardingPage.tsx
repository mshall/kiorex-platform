import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateImport, useImports } from "@/api/onboarding";
import { CardSkeleton, ErrorState } from "@/components/states";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusChip, type Tone } from "@/components/kit";
import { formatDateTime } from "@/lib/format";

export const STATUS_TONE: Record<string, Tone> = { DRAFT: "neutral", NEEDS_REVIEW: "warning", READY: "info", AWAITING_APPROVAL: "info", APPROVED: "brand", COMMITTING: "brand", COMMIT_FAILED: "danger", COMMITTED: "success", ROLLING_BACK: "warning", ROLLED_BACK: "neutral" };

/** Organization onboarding: super admins import another organization's SQL dump / spreadsheets / patient files into a quarantined batch, resolve what the scan flags, then commit with a second person's approval. */
export default function OnboardingPage() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate(); const q = useImports(); const create = useCreateImport();
  const [open, setOpen] = useState(false); const [orgId, setOrgId] = useState(""); const [orgName, setOrgName] = useState("");
  const submit = () => create.mutate({ orgId: orgId.trim(), orgName: orgName.trim() }, { onSuccess: (b) => { setOpen(false); nav(`/onboarding/${b.id}`); }, onError: () => toast.error(t("onb.createFailed")) });
  return (
    <div>
      <PageHeader title={t("onb.title")} hint={t("onb.hint")} actions={<Button onClick={() => setOpen(true)} data-testid="onb-new"><Plus aria-hidden="true" />{t("onb.newBatch")}</Button>} />
      {q.isLoading ? <CardSkeleton rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <DataTable caption={t("onb.title")} rows={q.data!} rowKey={(r) => r.id} empty={t("onb.none")} onRowClick={(r) => nav(`/onboarding/${r.id}`)} columns={[
          { key: "o", header: t("onb.org"), cell: (r) => <div><b>{r.orgName}</b><div className="text-xs text-muted-foreground" dir="ltr">{r.orgId}</div></div> },
          { key: "s", header: t("onb.status"), cell: (r) => <StatusChip tone={STATUS_TONE[r.status] ?? "neutral"}>{t(`onb.st.${r.status}`)}</StatusChip> },
          { key: "b", header: t("onb.blockers"), cell: (r) => <span className="kx-label-num">{r.summary?.stats.blockers ?? 0}</span> },
          { key: "p", header: t("onb.patients"), cell: (r) => <span className="kx-label-num">{r.summary?.stats.rows.patients ?? 0}</span> },
          { key: "c", header: t("onb.created"), cell: (r) => <span className="whitespace-nowrap text-xs">{formatDateTime(r.createdAt, i18n.language)}</span> },
        ]} />
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("onb.newBatch")}</DialogTitle><DialogDescription>{t("onb.newHint")}</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div><Label htmlFor="onb-org-id">{t("onb.orgId")}</Label><Input id="onb-org-id" dir="ltr" value={orgId} onChange={(e) => setOrgId(e.target.value)} data-testid="onb-org-id" /></div>
            <div><Label htmlFor="onb-org-name">{t("onb.orgName")}</Label><Input id="onb-org-name" value={orgName} onChange={(e) => setOrgName(e.target.value)} data-testid="onb-org-name" /></div>
          </div>
          <DialogFooter><Button disabled={!orgId.trim() || !orgName.trim() || create.isPending} onClick={submit} data-testid="onb-create">{t("onb.create")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
