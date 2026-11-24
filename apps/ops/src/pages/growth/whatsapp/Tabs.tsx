import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GrowthPage } from "@/components/growth/GrowthPage";
import AssistantPage from "./AssistantPage";
import BudgetsPage from "./BudgetsPage";
import ConversationsPage from "./ConversationsPage";
import EscalationsPage from "./EscalationsPage";

const TABS = [["assistant", AssistantPage], ["conversations", ConversationsPage], ["escalations", EscalationsPage], ["budgets", BudgetsPage]] as const;

/** The WhatsApp assistant workspace (GRW-P2-D): status, conversations, escalations, budgets. The two sidebar entries (WhatsApp, Assistant) open the same workspace on different tabs. */
export default function AssistantWorkspace({ section, initial }: { section: "whatsapp" | "assistant"; initial: (typeof TABS)[number][0] }) {
  const { t } = useTranslation(); const [tab, setTab] = useState<string>(initial); const Active = TABS.find(([k]) => k === tab)![1];
  return (
    <GrowthPage section={section}>
      <div role="tablist" aria-label={t("growth.whatsapp.tabs")} className="flex flex-wrap gap-2" data-testid="wa-tabs">
        {TABS.map(([k]) => <button key={k} id={`wa-tab-${k}`} role="tab" type="button" aria-selected={tab === k} aria-controls="wa-panel" className={`h-11 rounded-xl border px-4 text-sm font-semibold ${tab === k ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card"}`} onClick={() => setTab(k)} data-testid={`wa-tab-${k}`}>{t(`growth.whatsapp.tab.${k}`)}</button>)}
      </div>
      <div id="wa-panel" role="tabpanel" aria-labelledby={`wa-tab-${tab}`}><Active /></div>
    </GrowthPage>
  );
}
