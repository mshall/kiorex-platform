import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { StatusChip, type Tone } from "@/components/kit";
import { ApiError } from "@/api/errors";
import type { Catalog, JourneyGraph, JourneyStatus, Status } from "@/api/automation";

export const STATUS_TONE: Record<JourneyStatus, Tone> = { DRAFT: "neutral", PENDING_APPROVAL: "warning", PUBLISHED: "success", RETIRED: "neutral" };
export const inputCls = "h-11 w-full rounded-xl border border-input bg-card px-3 text-sm";
export const btnCls = "inline-flex h-11 items-center justify-center rounded-xl border px-4 text-sm font-semibold disabled:opacity-50";
export const primaryBtnCls = "inline-flex h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50";

/** The banner every automation page shows: the automation switch and the status of the marketing licence flag (launch-locked, never recorded by code). */
export function StatusBanner({ status }: { status: Status | undefined }) {
  const { t } = useTranslation();
  if (!status) return null;
  return (
    <div className="space-y-2" data-testid="auto-banner">
      {!status.automation.effective && <p role="alert" className="rounded-xl border border-destructive/40 p-3 text-sm" data-testid="auto-banner-off">{t("growth.automation.banner.automationOff")}</p>}
      <p role="status" className={`rounded-xl border p-3 text-sm ${status.marketingLicence.effective ? "" : "border-warning/50 bg-card"}`} data-testid="auto-banner-licence">{status.marketingLicence.effective ? t("growth.automation.banner.licenceOn") : t("growth.automation.banner.licenceOff")}</p>
    </div>
  );
}

export const StatusLabel = ({ status, killed }: { status: JourneyStatus; killed?: boolean }) => {
  const { t } = useTranslation();
  return <StatusChip tone={killed ? "danger" : STATUS_TONE[status]}>{killed ? t("growth.automation.killed") : t(`growth.automation.status.${status}`)}</StatusChip>;
};

export const errText = (t: TFunction, x: unknown) => (x instanceof ApiError ? t(`growth.automation.err.${x.code}`, { defaultValue: x.message }) : t("growth.automation.err.generic"));

const humanDelay = (t: TFunction, minutes: number) => minutes % 1440 === 0 ? `${minutes / 1440} ${t("growth.automation.unit.days")}` : minutes % 60 === 0 ? `${minutes / 60} ${t("growth.automation.unit.hours")}` : `${minutes} ${t("growth.automation.unit.minutes")}`;
export { humanDelay };

/** The journey as a vertical flow: trigger, steps, the inserted gate marker in front of every marketing message, then the end (or the arms of a split). Read-only; it works at any width. */
export function FlowView({ graph, catalog }: { graph: JourneyGraph; catalog: Catalog | undefined }) {
  const { t } = useTranslation();
  const byId = new Map(graph.nodes.map((n) => [n.id, n])); const out = (id: string) => graph.edges.filter((e) => e.from === id);
  const classOf = (tpl: string) => catalog?.templates.find((x) => x.key === tpl)?.messageClass ?? "TRANSACTIONAL";
  const box = "rounded-xl border bg-card p-3 text-sm";
  const sendBox = (n: { id: string; template?: string; channels?: string[] }) => {
    const marketing = classOf(n.template ?? "") === "MARKETING";
    return (
      <li key={n.id} className="space-y-2">
        {marketing && <div className={`${box} border-dashed`} data-testid="flow-gate"><strong>{t("growth.automation.builder.gate")}</strong></div>}
        <div className={box} data-testid={`flow-${n.id}`}><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{t("growth.automation.builder.send")}: {t(`growth.automation.template.${n.template}`, { defaultValue: n.template })}</span>
          <StatusChip tone={marketing ? "warning" : "info"}>{t(`growth.automation.class.${classOf(n.template ?? "")}`)}</StatusChip></div>
          {n.channels?.length ? <p className="mt-1 text-muted-foreground">{n.channels.map((c) => t(`growth.automation.channel.${c}`)).join(" > ")}</p> : null}</div>
      </li>
    );
  };
  const items: React.ReactNode[] = []; let cur = graph.nodes.find((n) => n.type === "TRIGGER"); const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id); const n = cur;
    if (n.type === "TRIGGER") items.push(<li key={n.id} className={box} data-testid="flow-trigger"><strong>{t("growth.automation.builder.fields.trigger")}:</strong> {t(`growth.automation.trigger.${n.event}`, { defaultValue: n.event })}</li>);
    else if (n.type === "WAIT") items.push(<li key={n.id} className={box} data-testid={`flow-${n.id}`}>{t("growth.automation.builder.wait")} {humanDelay(t, n.minutes ?? 0)}</li>);
    else if (n.type === "CONDITION") items.push(<li key={n.id} className={box} data-testid={`flow-${n.id}`}>{t("growth.automation.builder.condition")}: <span dir="ltr" className="break-all text-muted-foreground">{JSON.stringify(n.segment)}</span></li>);
    else if (n.type === "SEND") items.push(sendBox(n));
    else if (n.type === "BRANCH_EXPERIMENT") {
      items.push(<li key={n.id} className={box} data-testid="flow-split"><strong>{t("growth.automation.builder.split")}:</strong> <span dir="ltr">{n.experiment}</span>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">{out(n.id).map((e) => { const s = byId.get(e.to); return <li key={e.to} className="space-y-2"><p className="text-xs text-muted-foreground">{t("growth.automation.builder.arm")}: <span dir="ltr">{e.label}</span></p><ul className="space-y-2">{s ? sendBox(s) : null}</ul></li>; })}</ul></li>);
      break;
    } else if (n.type === "END") { items.push(<li key={n.id} className={`${box} text-muted-foreground`} data-testid="flow-end">END</li>); break; }
    const nx = out(n.id)[0]; cur = nx ? byId.get(nx.to) : undefined;
  }
  return <ol className="space-y-2" data-testid="flow">{items}</ol>;
}
