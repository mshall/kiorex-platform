import { useTranslation } from "react-i18next";
import { Home, Lock, Stethoscope, Activity } from "lucide-react";
import { useCareTypes } from "@/api/home";
import type { CareType } from "@/api/types";
import { cn } from "@/lib/utils";

const ICON: Record<CareType, typeof Home> = { DOCTORS: Stethoscope, PHYSIOTHERAPY: Activity, HOME_NURSING: Home };
// Fallback labels while GET /care-types loads or fails: the section is still usable, never blank.
export const CARE_TYPES: CareType[] = ["DOCTORS", "PHYSIOTHERAPY", "HOME_NURSING"];

/** KXMDS01: Doctors · Physiotherapy · Home nursing. A category whose flag is OFF or awaiting its launch gate (GPR1 / GHV*) is shown locked, not hidden. */
export function CareTypeTabs({ active, onPick }: { active?: CareType; onPick: (c: CareType | undefined) => void }) {
  const { t, i18n } = useTranslation();
  const q = useCareTypes();
  const ar = i18n.language.startsWith("ar");
  const items = q.data ?? CARE_TYPES.map((code) => ({ code, enabled: true, labelEn: t(`hv.care.${code}`), labelAr: t(`hv.care.${code}`), reason: "ON", providerCount: 0, flag: null }));
  return (
    <div role="group" aria-label={t("hv.careTypes")} className="flex flex-wrap gap-2" data-testid="care-types" aria-busy={q.isLoading}>
      {items.map((c) => {
        const Icon = ICON[c.code];
        const locked = !c.enabled;
        return (
          <button key={c.code} type="button" className={cn("kx-chip", locked && "opacity-70")} aria-pressed={active === c.code} data-testid={`care-${c.code}`} data-locked={locked || undefined}
            aria-disabled={locked || undefined} title={locked ? t("hv.categoryAwaiting") : undefined} onClick={() => !locked && onPick(active === c.code ? undefined : c.code)}>
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span>{ar ? c.labelAr : c.labelEn}</span>
            {locked && <><Lock className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">{t("hv.categoryAwaiting")}</span></>}
          </button>
        );
      })}
    </div>
  );
}
