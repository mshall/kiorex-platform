import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { StatusChip, PageHeader } from "@/components/kit";
import { useMarketList } from "@/api/hooks";
import { fixedMarket, shouldShowMarketSelector } from "@/lib/marketVisibility";
import { GROWTH_SECTIONS, sectionOf } from "./sections";

export const selectCls = "h-11 rounded-xl border border-input bg-card px-3 text-sm";

/** Market for a Growth page. The selector appears only when more than one market is live (founder rule, 23 Nov 2026); otherwise the single live market is fixed. */
export function useGrowthMarket() {
  const list = useMarketList().data;
  const [chosen, setChosen] = useState<string | null>(null);
  const show = shouldShowMarketSelector(list);
  return { market: show && chosen ? chosen : fixedMarket(list), setMarket: setChosen, show, markets: (list ?? []).filter((m) => m.live).map((m) => m.code) };
}

export function MarketSelect({ g }: { g: ReturnType<typeof useGrowthMarket> }) {
  const { t } = useTranslation();
  if (!g.show) return null;
  return (<label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{t("growth.common.market")}</span><select className={selectCls} value={g.market} onChange={(e) => g.setMarket(e.target.value)} data-testid="growth-market">{g.markets.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>);
}
export function DaysSelect({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { t } = useTranslation();
  return (<label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{t("growth.common.period")}</span><select className={selectCls} value={value} onChange={(e) => onChange(Number(e.target.value))} data-testid="growth-days">{[7, 14, 30, 90].map((d) => <option key={d} value={d}>{t("growth.common.lastDays", { count: d })}</option>)}</select></label>);
}

/** One header for every Growth page: title, hint, Phase 1 / Planned badge, and (on narrow screens) a section picker because the sidebar group is not visible there. */
export function GrowthPage({ section, children, actions, toolbar }: { section: string; children: ReactNode; actions?: ReactNode; toolbar?: ReactNode }) {
  const { t } = useTranslation(); const nav = useNavigate();
  const s = sectionOf(section);
  return (
    <div className="space-y-5" data-testid={`growth-page-${section}`}>
      <label className="block md:hidden"><span className="sr-only">{t("growth.nav.pick")}</span>
        <select className={`${selectCls} w-full`} value={s?.to ?? "/growth"} onChange={(e) => nav(e.target.value)} data-testid="growth-section-picker">
          {GROWTH_SECTIONS.map((x) => <option key={x.key} value={x.to}>{t(`growth.sections.${x.key}.nav`)}{x.status === "planned" ? ` (P${x.phase})` : ""}</option>)}
        </select>
      </label>
      <PageHeader title={t(`growth.sections.${section}.title`)} hint={t(`growth.sections.${section}.hint`)} actions={actions}
        badge={s?.status === "planned" ? <StatusChip tone="warning">{t("growth.planned.badge", { phase: s.phase })}</StatusChip> : <StatusChip tone="success">{s?.phase ? t("growth.livePhase", { phase: s.phase }) : t("growth.live")}</StatusChip>} />
      {toolbar && <div className="flex flex-wrap items-center gap-3">{toolbar}</div>}
      {children}
    </div>
  );
}

/** Key figure card list helper. */
export function Section({ title, hint, children, className, id }: { title: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (<section className={`kx-card p-4 md:p-5 ${className ?? ""}`} aria-labelledby={id}><h2 id={id} className="text-lg">{title}</h2>{hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}<div className="mt-3">{children}</div></section>);
}
