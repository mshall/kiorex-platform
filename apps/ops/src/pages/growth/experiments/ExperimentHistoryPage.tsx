import { useTranslation } from "react-i18next";
import { useExperimentHistory } from "@/api/experiments";

/** The append-only history of one experiment: who did what and when, with the stored change. Everything is rendered as text (never as markup). */
export default function ExperimentHistoryPage({ id }: { id: string }) {
  const { t } = useTranslation(); const h = useExperimentHistory(id); const rows = h.data ?? [];
  if (h.isLoading) return <p className="text-sm text-muted-foreground">…</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground" data-testid="hist-empty">{t("growth.experiments.history.empty")}</p>;
  return (
    <ol className="space-y-3" data-testid="exp-history" aria-label={t("growth.experiments.history.title")}>
      {rows.map((e) => (
        <li key={e.id} className="rounded-xl border bg-card p-3" data-testid={`hist-${e.kind}`}>
          <div className="flex flex-wrap items-center justify-between gap-2"><strong>{t(`growth.experiments.history.kinds.${e.kind}`, { defaultValue: e.kind })}</strong><time className="text-xs text-muted-foreground" dateTime={e.at}>{new Date(e.at).toLocaleString()}</time></div>
          <p className="mt-1 break-all text-sm" dir="ltr">{e.actor}</p>
          {e.reason && <p className="mt-1 text-sm">{e.reason}</p>}
          {Object.keys(e.diff ?? {}).length > 0 && <details className="mt-1 text-xs"><summary className="min-h-11 cursor-pointer py-2">{t("growth.experiments.history.diff")}</summary><pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-2" dir="ltr">{JSON.stringify(e.diff, null, 1)}</pre></details>}
        </li>
      ))}
    </ol>
  );
}
