import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import { ApiError } from "@/api/errors";
import { rawApi, rawText } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CardSkeleton, ErrorState } from "@/components/states";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { formatMinor } from "@/lib/format";

interface Signal { id: string; pspRef: string; reference: string | null; amountMinor: number; currency: string; confidence: number; decision: "AUTO" | "REVIEW" | "UNMATCHED"; reasons: string[]; candidates: Array<{ targetId: string }>; payerMasked: string | null }
interface Fraud { id: string; paymentId: string; score: number; band: "LOW" | "MEDIUM" | "HIGH"; signals: Array<{ rule: string; detail: string }>; mode: string }
type Tab = "match" | "fraud" | "report";
const err = (e: unknown, t: TFunction) => toast.error(e instanceof ApiError ? `${e.code}: ${e.message}` : t("states.errorTitle"));

/** Kiorly Pay unified layer (ops): invoice matching queue (finance role), SHADOW fraud queue (support decides), rollup downloads (CSV / PDF, AR / EN). Kiorly never holds funds; nothing here moves money. */
export default function PayOpsPage() {
  const { t, i18n } = useTranslation(); const qc = useQueryClient(); const [tab, setTab] = useState<Tab>("match");
  const inv = () => { void qc.invalidateQueries({ queryKey: ["payops"] }); };
  return (
    <div>
      <PageHeader title={t("payOps.title")} hint={t("payOps.hint")} />
      <div role="tablist" aria-label={t("payOps.title")} className="mb-4 flex gap-2">
        {(["match", "fraud", "report"] as Tab[]).map((k) => <button key={k} role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls={`panel-${k}`} data-testid={`tab-${k}`} onClick={() => setTab(k)} className={`h-11 rounded-xl border px-4 text-sm ${tab === k ? "bg-primary text-primary-foreground" : "bg-card"}`}>{t(`payOps.tabs.${k}`)}</button>)}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "match" && <Matching t={t} lang={i18n.language} inv={inv} />}
        {tab === "fraud" && <FraudQueue t={t} inv={inv} />}
        {tab === "report" && <Reports t={t} />}
      </div>
    </div>
  );
}

type T = TFunction;
function Matching({ t, lang, inv }: { t: T; lang: string; inv: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null); const [target, setTarget] = useState<Record<string, string>>({});
  const q = useQuery({ queryKey: ["payops", "queue"], queryFn: () => rawApi<Signal[]>("GET", "/admin/payments/matching/queue") });
  const up = useMutation({ mutationFn: async (f: File) => rawApi<{ received: number; applied: number; queued: number; duplicates: number }>("POST", "/admin/payments/matching/ipn", { content: await f.text(), filename: f.name, format: f.name.endsWith(".json") ? "json" : "csv" }), onSuccess: (r) => { toast.success(t("payOps.match.result", r)); inv(); }, onError: (e) => err(e, t) });
  const act = useMutation({ mutationFn: (a: { id: string; op: "confirm" | "reject"; targetId?: string }) => rawApi("POST", `/admin/payments/matching/${a.id}/${a.op}`, a.op === "confirm" ? { targetId: a.targetId } : {}), onSuccess: inv, onError: (e) => err(e, t) });
  if (q.error instanceof ApiError && q.error.status === 403) return <p role="alert" data-testid="finance-only">{t("payOps.match.financeOnly")}</p>;
  return (
    <section aria-labelledby="mt-h">
      <h2 id="mt-h" className="text-base font-semibold">{t("payOps.match.upload")}</h2>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div><Label htmlFor="ipn-file">{t("payOps.match.file")}</Label><input id="ipn-file" ref={fileRef} type="file" accept=".csv,.json" className="mt-1 block h-11 text-sm" data-testid="ipn-file" /></div>
        <Button onClick={() => { const f = fileRef.current?.files?.[0]; if (f) up.mutate(f); else toast.error(t("payOps.match.pick")); }} disabled={up.isPending} data-testid="ipn-send"><Upload aria-hidden="true" />{t("payOps.match.send")}</Button>
      </div>
      <h2 className="mb-2 mt-6 text-base font-semibold">{t("payOps.match.queue")}</h2>
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <DataTable caption={t("payOps.match.queue")} rows={q.data!} rowKey={(r) => r.id} empty={t("payOps.match.empty")} columns={[
          { key: "r", header: t("payOps.match.ref"), cell: (r) => <code dir="ltr" className="text-xs">{r.pspRef}{r.reference ? ` / ${r.reference}` : ""}</code> },
          { key: "a", header: t("payOps.match.amount"), cell: (r) => <b className="kx-label-num">{formatMinor(r.amountMinor, lang, r.currency)}</b> },
          { key: "d", header: t("payOps.match.decision"), cell: (r) => <Badge variant="warning">{t(`payOps.match.decisions.${r.decision}`)}</Badge> },
          { key: "c", header: t("payOps.match.confidence"), cell: (r) => `${Math.round(r.confidence * 100)}%` },
          { key: "w", header: t("payOps.match.reasons"), cell: (r) => r.reasons.join(", ") },
          { key: "t", header: t("payOps.match.target"), cell: (r) => <><Label htmlFor={`tg-${r.id}`} className="sr-only">{t("payOps.match.target")}</Label><input id={`tg-${r.id}`} dir="ltr" className="h-11 w-44 rounded-xl border bg-background px-2 text-xs" defaultValue={r.candidates[0]?.targetId ?? ""} onChange={(e) => setTarget({ ...target, [r.id]: e.target.value })} /></> },
          { key: "x", header: "", cell: (r) => <div className="flex gap-2"><Button size="sm" data-testid={`confirm-${r.id}`} onClick={() => act.mutate({ id: r.id, op: "confirm", targetId: target[r.id] ?? r.candidates[0]?.targetId })}>{t("payOps.match.confirm")}</Button><Button size="sm" variant="outline" onClick={() => act.mutate({ id: r.id, op: "reject" })}>{t("payOps.match.reject")}</Button></div> },
        ]} />
      )}
    </section>
  );
}

function FraudQueue({ t, inv }: { t: T; inv: () => void }) {
  const q = useQuery({ queryKey: ["payops", "fraud"], queryFn: () => rawApi<Fraud[]>("GET", "/admin/payments/fraud/queue") });
  const act = useMutation({ mutationFn: (a: { id: string; outcome: string }) => rawApi("POST", `/admin/payments/fraud/${a.id}/review`, { outcome: a.outcome }), onSuccess: inv, onError: (e) => err(e, t) });
  return (
    <section aria-labelledby="fr-h">
      <h2 id="fr-h" className="text-base font-semibold">{t("payOps.tabs.fraud")}</h2>
      <p className="mt-1 text-sm text-muted-foreground" data-testid="shadow-note">{t("payOps.fraud.shadow")}</p>
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <DataTable caption={t("payOps.tabs.fraud")} rows={q.data!} rowKey={(r) => r.id} empty={t("payOps.fraud.empty")} columns={[
          { key: "p", header: t("payOps.fraud.payment"), cell: (r) => <code dir="ltr" className="text-xs">{r.paymentId}</code> },
          { key: "s", header: t("payOps.fraud.score"), cell: (r) => <b className="kx-label-num">{r.score}</b> },
          { key: "b", header: t("payOps.fraud.band"), cell: (r) => <Badge variant={r.band === "HIGH" ? "destructive" : "warning"}>{t(`payOps.fraud.bands.${r.band}`)}</Badge> },
          { key: "g", header: t("payOps.fraud.signals"), cell: (r) => r.signals.map((s) => s.rule).join(", ") },
          { key: "x", header: t("payOps.fraud.review"), cell: (r) => <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => act.mutate({ id: r.id, outcome: "FALSE_POSITIVE" })}>{t("payOps.fraud.fp")}</Button><Button size="sm" variant="outline" onClick={() => act.mutate({ id: r.id, outcome: "CONFIRMED" })}>{t("payOps.fraud.ok")}</Button><Button size="sm" variant="ghost" onClick={() => act.mutate({ id: r.id, outcome: "DISMISSED" })}>{t("payOps.fraud.dismiss")}</Button></div> },
        ]} />
      )}
    </section>
  );
}

function Reports({ t }: { t: T }) {
  const [level, setLevel] = useState("platform"); const [lang, setLang] = useState<"en" | "ar">("en");
  const get = async (format: "csv" | "pdf") => {
    try {
      const body = await rawText(`/admin/payments/reports/rollup?level=${level}&lang=${lang}&format=${format}`);
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([body], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/pdf" })); a.download = `payments-rollup.${format}`; a.click();
    } catch (e) { err(e, t); }
  };
  return (
    <section aria-labelledby="rp-h">
      <h2 id="rp-h" className="text-base font-semibold">{t("payOps.tabs.report")}</h2>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div><Label htmlFor="rp-level">{t("payOps.report.level")}</Label><select id="rp-level" className="mt-1 h-11 rounded-xl border bg-background px-3 text-sm" value={level} onChange={(e) => setLevel(e.target.value)}>{["platform", "organisation", "psp", "day"].map((l) => <option key={l} value={l}>{t(`payOps.report.levels.${l}`)}</option>)}</select></div>
        <div><Label htmlFor="rp-lang">{t("payOps.report.lang")}</Label><select id="rp-lang" className="mt-1 h-11 rounded-xl border bg-background px-3 text-sm" value={lang} onChange={(e) => setLang(e.target.value as "en" | "ar")}><option value="en">English</option><option value="ar">العربية</option></select></div>
        <Button onClick={() => void get("csv")} data-testid="dl-csv"><Download aria-hidden="true" />{t("payOps.report.csv")}</Button>
        <Button variant="outline" onClick={() => void get("pdf")} data-testid="dl-pdf"><Download aria-hidden="true" />{t("payOps.report.pdf")}</Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t("payOps.report.branchNote")}</p>
    </section>
  );
}
