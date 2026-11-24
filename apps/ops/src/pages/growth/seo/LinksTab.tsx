import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSeoLinks, useSeoOverview } from "@/api/seoAutomation";
import { StatCard } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { Section } from "@/components/growth/GrowthPage";
import { fmtN } from "@/lib/growthFormat";

/** The computed internal link graph: totals by rule, pages with no inbound link, and the links of one page. */
export default function LinksTab() {
  const { t, i18n } = useTranslation(); const q = useSeoOverview(); const [key, setKey] = useState(""); const [shown, setShown] = useState(""); const one = useSeoLinks(shown);
  if (q.isLoading) return <CardSkeleton rows={3} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data; const lang = i18n.language.startsWith("ar") ? "ar" : "en";
  return (
    <div className="space-y-5" data-testid="seo-links-tab">
      <p className="text-sm text-muted-foreground">{t("growth.seoAuto.linksHint")}</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3"><StatCard label={t("growth.seoAuto.linksTotal")} value={fmtN(d.links.total)} /><StatCard label={t("growth.seoAuto.orphans")} value={fmtN(d.orphans.length)} tone={d.orphans.length ? "warn" : "ok"} /></div>
      <Section title={t("growth.seoAuto.linksTitle")} id="seol-rules">
        <DataTable caption={t("growth.seoAuto.linksTitle")} rows={d.links.byRule} rowKey={(r) => r.rule} empty={t("growth.seoAuto.notMeasured")} columns={[{ key: "r", header: t("growth.seoAuto.linkRule"), cell: (r) => <code className="text-xs">{r.rule}</code> }, { key: "c", header: t("growth.seoAuto.count"), cell: (r) => <span className="kx-label-num">{fmtN(r.count)}</span> }]} />
      </Section>
      <Section title={t("growth.seoAuto.orphans")} id="seol-orphans">
        {d.orphans.length === 0 ? <p className="text-sm" data-testid="seo-no-orphans">{t("growth.seoAuto.noOrphans")}</p> : <ul className="space-y-1 text-sm" data-testid="seo-orphans">{d.orphans.map((k) => <li key={k}><code dir="ltr">{k}</code></li>)}</ul>}
      </Section>
      <Section title={t("growth.seoAuto.lookup")} id="seol-page">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setShown(key.trim()); }}>
          <label className="min-w-64 flex-1 text-sm"><span className="mb-1 block text-muted-foreground">{t("growth.seoAuto.lookup")}</span><Input dir="ltr" value={key} onChange={(e) => setKey(e.target.value)} data-testid="seo-link-key" /></label>
          <Button type="submit" disabled={!key.trim()} data-testid="seo-link-go">{t("growth.seoAuto.lookupGo")}</Button>
        </form>
        {shown && (one.isLoading ? <CardSkeleton rows={2} /> : one.error ? <ErrorState error={one.error} onRetry={() => void one.refetch()} /> : (
          <div className="mt-3 space-y-3" data-testid="seo-link-groups">{(one.data?.groups ?? []).map((g) => <div key={g.kind}><h3 className="text-sm font-semibold">{g.kind}</h3><ul className="text-sm">{g.links.map((l) => <li key={l.path}><a className="underline" href={l.path} dir="ltr">{l.label[lang]}</a></li>)}</ul></div>)}</div>
        ))}
      </Section>
    </div>
  );
}
