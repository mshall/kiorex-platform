import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { CalendarClock } from "lucide-react";
import { StatusChip } from "@/components/kit";
import { GrowthPage, Section } from "@/components/growth/GrowthPage";
import { sectionOf } from "@/components/growth/sections";

const list = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

/** Honest placeholder for a later-phase page: scope, status and dependencies, and what exists today. There is no data, no form and no action here. */
export default function GrowthPlannedPage({ section }: { section: string }) {
  const { t } = useTranslation(); const s = sectionOf(section);
  const k = (x: string) => `growth.sections.${section}.${x}`;
  return (
    <GrowthPage section={section}>
      <div className="kx-card space-y-4 p-5" data-testid="planned-state" data-phase={s?.phase}>
        <p className="flex flex-wrap items-center gap-3"><CalendarClock className="h-6 w-6 text-warning" aria-hidden="true" /><span className="text-xl font-semibold" data-testid="planned-title">{t("growth.planned.title", { phase: s?.phase })}</span><StatusChip tone="warning">{t("growth.planned.statusNotBuilt")}</StatusChip></p>
        <p className="text-sm text-muted-foreground">{t("growth.planned.honest")}</p>
        <div className="grid gap-4 md:grid-cols-2">
          <Section title={t("growth.planned.scope")} id={`pl-scope-${section}`}><ul className="list-disc space-y-1 ps-5 text-sm" data-testid="planned-scope">{list(t(k("scope"), { returnObjects: true })).map((x) => <li key={x}>{x}</li>)}</ul></Section>
          <Section title={t("growth.planned.dependencies")} id={`pl-deps-${section}`}><ul className="list-disc space-y-1 ps-5 text-sm" data-testid="planned-deps">{list(t(k("deps"), { returnObjects: true })).map((x) => <li key={x}>{x}</li>)}</ul></Section>
        </div>
        <Section title={t("growth.planned.today")} id={`pl-today-${section}`}><p className="text-sm" data-testid="planned-today">{t(k("today"))}</p></Section>
        <dl className="grid gap-2 text-sm sm:grid-cols-3"><div><dt className="text-muted-foreground">{t("growth.planned.package")}</dt><dd><code>{s?.pkg}</code></dd></div><div><dt className="text-muted-foreground">{t("growth.planned.status")}</dt><dd>{t("growth.planned.statusValue")}</dd></div><div><dt className="text-muted-foreground">{t("growth.planned.flag")}</dt><dd><Link className="text-primary hover:underline" to="/flags"><code>{t(k("flag"))}</code></Link></dd></div></dl>
      </div>
    </GrowthPage>
  );
}
