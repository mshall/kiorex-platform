import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CalendarClock, Download, Files, Plus, ShieldCheck, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "@/api/errors";
import {
  MAX_UPLOAD_BYTES, UPLOAD_TYPES, useCancelFollowUp, useCreateFollowUp, useDeleteVaultItem, useFollowUps, usePrescriptions, useRecordSharing, useSetRecordSharing, useUploadRecord, useVault,
  type RecordScope, type VaultItem,
} from "@/api/services";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/states";
import { kindIcon, ReadOnlyBanner } from "@/components/VaultBits";
import { PrescriptionCard } from "@/components/PrescriptionCard";
import { track } from "@/lib/analytics";
import { formatBytes, formatDate } from "@/lib/format";

const KINDS = ["ALL", "VISIT_SUMMARY", "PRESCRIPTION", "LAB_RESULT", "UPLOAD"] as const;

function DeleteDialog({ item, onClose }: { item: VaultItem | null; onClose: () => void }) {
  const { t } = useTranslation();
  const del = useDeleteVaultItem();
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("records.deleteTitle")}</DialogTitle><DialogDescription>{t("records.deleteBody")}</DialogDescription></DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="destructive" disabled={del.isPending} data-testid="confirm-delete" onClick={() => item && del.mutate(item.id, { onSuccess: () => { toast.success(t("records.deleted")); onClose(); }, onError: () => toast.error(t("records.errors.generic")) })}>{t("records.delete")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UploadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const up = useUploadRecord();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const reset = () => { setFile(null); setTitle(""); setErr(null); };
  const pick = (f: File | null) => {
    setErr(null); setFile(null);
    if (!f) return;
    if (!UPLOAD_TYPES.includes(f.type)) return setErr(t("records.errors.type"));
    if (f.size > MAX_UPLOAD_BYTES) return setErr(t("records.errors.size", { max: formatBytes(MAX_UPLOAD_BYTES, "en") }));
    setFile(f);
  };
  const submit = () => file && up.mutate({ file, title: title.trim() || undefined }, {
    onSuccess: () => { toast.success(t("records.uploaded")); reset(); onClose(); },
    onError: (e) => setErr(e instanceof ApiError && e.isFeatureDisabled ? t("records.readOnlyBody") : e instanceof ApiError && e.code === "FILE_TOO_LARGE" ? t("records.errors.size", { max: formatBytes(MAX_UPLOAD_BYTES, "en") }) : e instanceof ApiError && e.code === "UNSUPPORTED_FILE_TYPE" ? t("records.errors.type") : t("records.errors.generic")),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("records.uploadTitle")}</DialogTitle><DialogDescription>{t("records.uploadHint")}</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2"><Label htmlFor="rec-file">{t("records.file")}</Label><Input id="rec-file" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(e) => pick(e.target.files?.[0] ?? null)} data-testid="upload-file" /></div>
          <div className="space-y-2"><Label htmlFor="rec-title">{t("records.titleOptional")}</Label><Input id="rec-title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          {err && <p role="alert" className="text-sm text-destructive" data-testid="upload-error">{err}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => { reset(); onClose(); }}>{t("common.cancel")}</Button><Button disabled={!file || up.isPending} onClick={submit} data-testid="upload-submit">{up.isPending ? t("states.loading") : t("records.upload")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordsTab({ readOnly }: { readOnly: boolean }) {
  const { t, i18n } = useTranslation();
  const [kind, setKind] = useState<(typeof KINDS)[number]>("ALL");
  const q = useVault(kind === "ALL" ? undefined : kind);
  const [del, setDel] = useState<VaultItem | null>(null);
  const [uploading, setUploading] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label={t("records.filter")} className="flex flex-wrap gap-2">
          {KINDS.map((k) => <button key={k} type="button" role="radio" aria-checked={kind === k} data-active={kind === k} className="kx-chip" onClick={() => setKind(k)}>{t(`records.kind.${k}`)}</button>)}
        </div>
        <Button onClick={() => setUploading(true)} disabled={readOnly} data-testid="upload-open"><Upload aria-hidden="true" />{t("records.upload")}</Button>
      </div>
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data!.items.length === 0 ? (
        <EmptyState icon={<Files className="h-10 w-10" aria-hidden="true" />} title={t("records.empty")} hint={t("records.emptyHint")} />
      ) : (
        <ul className="space-y-3" data-testid="vault-list">
          {q.data!.items.map((r) => {
            const Icon = kindIcon(r.kind);
            return (
              <li key={r.id} className="kx-card flex items-center gap-3 p-4" data-testid="vault-item" data-kind={r.kind}>
                <Icon className="h-6 w-6 shrink-0 text-ocean" aria-hidden="true" />
                <Link to={`/records/${r.id}`} className="min-w-0 flex-1 hover:underline" onClick={() => track("vault_opened")}>
                  <p className="truncate font-semibold">{recordTitle(r.title, t(`records.kind.${r.kind}`))}</p>
                  <p className="text-sm text-muted-foreground">{t(`records.kind.${r.kind}`)} · {t(`records.source.${r.source}`)} · {formatDate(r.signedAt ?? r.createdAt, i18n.language)}{r.sizeBytes ? ` · ${formatBytes(r.sizeBytes, i18n.language)}` : ""}</p>
                </Link>
                <Button variant="ghost" size="icon" aria-label={t("records.deleteItem", { title: recordTitle(r.title, t(`records.kind.${r.kind}`)) })} onClick={() => setDel(r)} data-testid="delete-record"><Trash2 aria-hidden="true" /></Button>
              </li>
            );
          })}
        </ul>
      )}
      <DeleteDialog item={del} onClose={() => setDel(null)} />
      <UploadDialog open={uploading} onClose={() => setUploading(false)} />
    </div>
  );
}

function PrescriptionsTab() {
  const { t } = useTranslation();
  const q = usePrescriptions();
  return q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data!.length === 0 ? (
    <EmptyState title={t("records.rxEmpty")} hint={t("records.rxEmptyHint")} />
  ) : (
    <div className="space-y-4"><p className="text-sm text-muted-foreground">{t("records.rxIntro")}</p><ul className="space-y-4" data-testid="rx-list">{q.data!.map((r) => <li key={r.id}><PrescriptionCard item={r} /></li>)}</ul></div>
  );
}

const DAYS = [7, 14, 30, 90];
function FollowUpsTab({ readOnly }: { readOnly: boolean }) {
  const { t, i18n } = useTranslation();
  const q = useFollowUps();
  const create = useCreateFollowUp();
  const cancel = useCancelFollowUp();
  const [days, setDays] = useState(14);
  return (
    <div className="space-y-4">
      <div className="kx-card space-y-3 p-5">
        <h3 className="text-lg">{t("records.followUpNew")}</h3>
        <p className="text-sm text-muted-foreground">{t("records.followUpHint")}</p>
        <div role="radiogroup" aria-label={t("records.followUpAfter")} className="flex flex-wrap gap-2">
          {DAYS.map((d) => <button key={d} type="button" role="radio" aria-checked={days === d} data-active={days === d} className="kx-chip" onClick={() => setDays(d)}>{t("records.followUpDays", { count: d })}</button>)}
        </div>
        <Button disabled={create.isPending || readOnly} data-testid="followup-create" onClick={() => create.mutate({ afterDays: days }, { onSuccess: () => toast.success(t("records.followUpSet")), onError: () => toast.error(t("records.errors.generic")) })}><Plus aria-hidden="true" />{t("records.followUpSet")}</Button>
      </div>
      {q.isLoading ? <CardSkeleton rows={1} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data!.length === 0 ? <EmptyState icon={<CalendarClock className="h-10 w-10" aria-hidden="true" />} title={t("records.followUpEmpty")} /> : (
        <ul className="space-y-3" data-testid="followup-list">
          {q.data!.map((f) => (
            <li key={f.id} className="kx-card flex items-center justify-between gap-3 p-4">
              <div><p className="font-semibold">{formatDate(f.dueAt, i18n.language)}</p><p className="text-sm text-muted-foreground">{t(`records.followUpSource.${f.source}`)}</p></div>
              <div className="flex items-center gap-2"><Badge variant={f.status === "DUE" ? "warning" : f.status === "CANCELLED" ? "secondary" : "info"}>{t(`records.followUpStatus.${f.status}`)}</Badge>
                {f.status !== "CANCELLED" && <Button variant="ghost" size="sm" onClick={() => cancel.mutate(f.id, { onError: () => toast.error(t("records.errors.generic")) })}>{t("common.cancel")}</Button>}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const SCOPES: RecordScope[] = ["VISIT_SUMMARY", "PRESCRIPTIONS", "LAB_RESULTS", "SHARE_WITH_OTHER_CLINICS"];
function SharingTab() {
  const { t } = useTranslation();
  const q = useRecordSharing();
  const set = useSetRecordSharing();
  const [revoke, setRevoke] = useState<RecordScope | null>(null);
  const flip = (scope: RecordScope, granted: boolean) => {
    if (!granted) { setRevoke(scope); return; }
    set.mutate({ scope, granted }, { onSuccess: () => toast.success(t("records.sharing.granted")), onError: (e) => toast.error(e instanceof ApiError && e.isFeatureDisabled ? t("records.sharing.paused") : t("records.errors.generic")) });
  };
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">{t("records.sharing.intro")}</p>
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <>
          {!q.data!.canGrant && <div role="status" className="rounded-xl border border-ocean/30 bg-info-soft p-4 text-sm text-info" data-testid="sharing-paused">{t("records.sharing.paused")}</div>}
          <ul className="space-y-3" data-testid="sharing-list">
            {SCOPES.map((scope) => {
              const s = q.data!.scopes.find((x) => x.scope === scope);
              const granted = !!s?.granted;
              return (
                <li key={scope} className="kx-card flex items-start justify-between gap-4 p-5" data-scope={scope}>
                  <div className="space-y-1"><Label htmlFor={`sw-${scope}`} className="text-base font-semibold">{t(`records.sharing.scope.${scope}.title`)}</Label><p className="text-sm text-muted-foreground">{t(`records.sharing.scope.${scope}.body`)}</p></div>
                  <Switch id={`sw-${scope}`} checked={granted} disabled={set.isPending || (!granted && !q.data!.canGrant)} onCheckedChange={(v) => flip(scope, v)} data-testid={`share-${scope}`} />
                </li>
              );
            })}
          </ul>
        </>
      )}
      <Dialog open={!!revoke} onOpenChange={(o) => !o && setRevoke(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("records.sharing.revokeTitle")}</DialogTitle><DialogDescription>{t("records.sharing.revokeBody")}</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoke(null)}>{t("common.cancel")}</Button>
            <Button variant="destructive" data-testid="confirm-revoke" disabled={set.isPending} onClick={() => revoke && set.mutate({ scope: revoke, granted: false }, { onSuccess: () => { toast.success(t("records.sharing.revoked")); setRevoke(null); }, onError: () => toast.error(t("records.errors.generic")) })}>{t("records.sharing.revoke")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The API stores English system titles for records it creates itself ("Lab report", "Visit summary", "Prescription"): show the localized kind label instead. User-entered titles are untouched. */
const SYSTEM_TITLES = new Set(["Lab report", "Visit summary", "Prescription"]);
const recordTitle = (title: string | null | undefined, kindLabel: string) => (!title || SYSTEM_TITLES.has(title) ? kindLabel : title);

export default function RecordsPage() {
  const { t } = useTranslation();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") ?? "records";
  const vault = useVault();
  const seen = useRef(false);
  useEffect(() => { if (!seen.current) { seen.current = true; track("vault_opened"); } }, []);
  const readOnly = !!vault.data?.readOnly;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3"><ShieldCheck className="h-7 w-7 text-ocean" aria-hidden="true" /><h1 className="text-2xl">{t("records.title")}</h1></div>
      <p className="max-w-2xl text-muted-foreground">{t("records.intro")}</p>
      {readOnly && <ReadOnlyBanner />}
      <Tabs value={tab} onValueChange={(v) => setSp(v === "records" ? {} : { tab: v })}>
        <TabsList className="h-auto flex-wrap">
          {(["records", "prescriptions", "followups", "sharing"] as const).map((k) => <TabsTrigger key={k} value={k} className="min-h-11 px-4" data-testid={`tab-${k}`}>{t(`records.tabs.${k}`)}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="records" className="mt-4"><RecordsTab readOnly={readOnly} /></TabsContent>
        <TabsContent value="prescriptions" className="mt-4"><PrescriptionsTab /></TabsContent>
        <TabsContent value="followups" className="mt-4"><FollowUpsTab readOnly={readOnly} /></TabsContent>
        <TabsContent value="sharing" className="mt-4"><SharingTab /></TabsContent>
      </Tabs>
      <p className="text-xs text-muted-foreground"><Download className="me-1 inline h-3 w-3" aria-hidden="true" />{t("records.privacyNote")}</p>
    </div>
  );
}
