import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCatalogue, useSaveStep, type Plan } from "@/api/marketOnboarding";
import { Section } from "@/components/growth/GrowthPage";

/** Step 7: bind the market to a data-residency cell from platform/data-cells.json. An unknown cell is refused by the API; with one deployed cell, a second market maps to it and the page says so. */
export default function DataCellStep({ plan, readOnly }: { plan: Plan; readOnly: boolean }) {
  const { t } = useTranslation(); const cat = useCatalogue(); const save = useSaveStep(plan.cc); const [cell, setCell] = useState((plan.steps.residency?.dataCellId as string | undefined) ?? "");
  const cells = cat.data?.dataCells; const same = cells && cell ? Object.entries(cells.bindings).filter(([, c]) => c === cell).map(([m]) => m) : [];
  return (
    <Section title={t("growth.marketWizard.cellTitle")} id="mw-cell" hint={t("growth.marketWizard.cellHint")}>
      <label className="block text-sm"><span className="block text-muted-foreground">{t("growth.marketWizard.cell")}</span>
        <select className="h-11 rounded-xl border border-input bg-card px-3 text-sm" value={cell} disabled={readOnly} onChange={(e) => setCell(e.target.value)} data-testid="cell-select"><option value="">{t("growth.marketWizard.pick")}</option>{(cells?.cells ?? []).map((c) => <option key={c} value={c}>{c}{cells?.deployed.includes(c) ? "" : ` (${t("growth.marketWizard.cellPrepared")})`}</option>)}</select></label>
      {same.length > 0 && <p className="mt-2 text-sm" data-testid="cell-same">{t("growth.marketWizard.sameCell", { markets: same.join(", ") })} {t("growth.marketWizard.crossCell")}</p>}
      <button type="button" className="mt-3 h-11 rounded-xl border border-primary bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={readOnly || !cell || save.isPending} onClick={() => save.mutate({ step: "residency", body: { dataCellId: cell } })} data-testid="cell-save">{t("growth.marketWizard.save")}</button>
      {save.isError && <p className="mt-2 text-sm text-destructive" role="alert">{(save.error as Error).message}</p>}{save.isSuccess && <p className="mt-2 text-sm" role="status">{t("growth.marketWizard.saved")}</p>}
    </Section>
  );
}
