import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GrowthPage } from "@/components/growth/GrowthPage";
import B2BLeadsPage from "./B2BLeadsPage";
import CorporateAccountsPage from "./CorporateAccountsPage";

/** GRW-P4-C: corporate accounts and the enterprise lead pipeline (an account's own page is a route below it). */
export default function CorporatePage() {
  const { t } = useTranslation(); const [tab, setTab] = useState<"accounts" | "leads">("accounts");
  return (
    <GrowthPage section="corporate">
      <div role="tablist" aria-label={t("growth.corporate.tabs")} className="flex gap-2">
        {(["accounts", "leads"] as const).map((k) => <button key={k} role="tab" type="button" id={`corp-tab-${k}`} aria-selected={tab === k} aria-controls={`corp-panel-${k}`} className={`h-11 rounded-xl border px-5 text-sm font-semibold ${tab === k ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`} onClick={() => setTab(k)} data-testid={`corp-tab-${k}`}>{t(`growth.corporate.tab.${k}`)}</button>)}
      </div>
      <div role="tabpanel" id={`corp-panel-${tab}`} aria-labelledby={`corp-tab-${tab}`}>{tab === "accounts" ? <CorporateAccountsPage /> : <B2BLeadsPage />}</div>
    </GrowthPage>
  );
}
