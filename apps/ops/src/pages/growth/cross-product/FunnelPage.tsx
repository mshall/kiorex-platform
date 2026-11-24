import { useTranslation } from "react-i18next";
import { Section } from "@/components/growth/GrowthPage";
import { fmtN } from "@/lib/growthFormat";
import type { Funnel, FunnelRow, Masked } from "@/api/crossProduct";

const ORIGINS = ["PROVIDER_LED", "MARKETPLACE", "UNATTRIBUTED"] as const;
const LAGS = ["LT_24H", "D1_3", "D3_7", "GT_7D"] as const;
/** The masked marker is a left-to-right island, so "<10" never reads as "10>" inside right-to-left Arabic. */
const cell = (v: Masked | undefined) => <bdi dir="ltr">{v === undefined ? "0" : v === "<10" ? "<10" : fmtN(v)}</bdi>;

function Row({ r }: { r: FunnelRow }) {
  const { t } = useTranslation();
  return (
    <tr data-testid={`cp-row-${r.entryPoint}`}>
      <th scope="row" className="border-b border-border/60 px-3.5 py-3 text-start font-medium">{t(`growth.crossProduct.entry.${r.entryPoint}`)}</th>
      {(["offered", "dismissed", "continued", "notContinued"] as const).map((k) => <td key={k} className="border-b border-border/60 px-3.5 py-3 tabular-nums" data-testid={`cp-${r.entryPoint}-${k}`}>{cell(r[k])}</td>)}
    </tr>
  );
}

/** Funnel: clinic visit -> prompt offered -> continued at the pharmacy, lab or as a home visit, then the split by the source of the FIRST booking and by time to continue. Counts only; "<10" is hidden by design. */
export default function FunnelPage({ data }: { data: Funnel }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-5" data-testid="cp-funnel">
      <div className="max-h-[72vh] overflow-auto rounded-xl border bg-card shadow-card" role="region" aria-label={t("growth.crossProduct.funnelCaption")} tabIndex={0}>
        <table className="w-full min-w-[640px] border-separate border-spacing-0 text-start text-sm">
          <caption className="sr-only">{t("growth.crossProduct.funnelCaption")}</caption>
          <thead><tr>{["step", "offered", "dismissed", "continued", "notContinued"].map((h) => <th key={h} scope="col" className="sticky top-0 border-b bg-muted px-3.5 py-2.5 text-start text-xs font-semibold text-muted-foreground">{t(`growth.crossProduct.col.${h}`)}</th>)}</tr></thead>
          <tbody>{data.products.map((r) => <Row key={r.entryPoint} r={r} />)}</tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="cp-k-note">{t("growth.crossProduct.kNote")}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.products.map((r) => (
          <Section key={r.entryPoint} title={t(`growth.crossProduct.entry.${r.entryPoint}`)} id={`cp-split-${r.entryPoint}`}>
            <h3 className="mt-1 text-sm font-semibold">{t("growth.crossProduct.bySource")}</h3>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
              {ORIGINS.map((o) => <div key={o} className="contents"><dt className="text-muted-foreground">{t(`growth.crossProduct.origin.${o}`)}</dt><dd className="text-end tabular-nums" data-testid={`cp-${r.entryPoint}-src-${o}`}>{cell(r.bySourceOfFirstBooking[o])}</dd></div>)}
            </dl>
            <h3 className="mt-3 text-sm font-semibold">{t("growth.crossProduct.timeToContinue")}</h3>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
              {LAGS.map((l) => <div key={l} className="contents"><dt className="text-muted-foreground">{t(`growth.crossProduct.lag.${l}`)}</dt><dd className="text-end tabular-nums" data-testid={`cp-${r.entryPoint}-lag-${l}`}>{cell(r.timeToContinue[l])}</dd></div>)}
            </dl>
          </Section>
        ))}
      </div>
    </div>
  );
}
