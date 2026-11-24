import { useTranslation } from "react-i18next";
import { Section } from "@/components/growth/GrowthPage";
import { StatusChip } from "@/components/kit";

const MODELS = ["LAST_TOUCH", "LAST_NON_DIRECT", "FIRST_TOUCH", "LINEAR", "TIME_DECAY", "POSITION_BASED", "DATA_DRIVEN"] as const;

/** What each model does, the look-back windows and why POSITION_BASED is the default. Static explanation: no data, no action. */
export default function ModelsPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      <Section title={t("growth.attributionModels.modelsTitle")} id="am-models" hint={t("growth.attributionModels.modelsHint")}>
        <dl className="grid gap-3 md:grid-cols-2" data-testid="models-glossary">
          {MODELS.map((m) => <div key={m} className="rounded-xl border bg-card p-3"><dt className="flex items-center gap-2 font-semibold">{t(`growth.attributionModels.model.${m}`)}{m === "POSITION_BASED" && <StatusChip tone="info" dot={false}>{t("growth.attributionModels.default")}</StatusChip>}</dt><dd className="mt-1 text-sm text-muted-foreground">{t(`growth.attributionModels.explain.${m}`)}</dd></div>)}
        </dl>
      </Section>
      <Section title={t("growth.attributionModels.windowsTitle")} id="am-windows" hint={t("growth.attributionModels.windowsHint")}>
        <ul className="list-disc space-y-1 ps-5 text-sm" data-testid="models-windows"><li>{t("growth.attributionModels.windowWeb")}</li><li>{t("growth.attributionModels.windowCampaign")}</li><li>{t("growth.attributionModels.windowProvider")}</li><li>{t("growth.attributionModels.windowNever")}</li></ul>
      </Section>
      <Section title={t("growth.attributionModels.crossDeviceTitle")} id="am-cross">
        <p className="text-sm">{t("growth.attributionModels.crossDevice")}</p>
      </Section>
    </div>
  );
}
