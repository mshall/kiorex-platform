import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { GROWTH_SECTIONS } from "./sections";

/** Collapsible "Growth & Patient Acquisition" group in the ops sidebar. Opens by itself on any /growth route. */
export function GrowthNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const inside = pathname === "/growth" || pathname.startsWith("/growth/");
  const [override, setOverride] = useState<boolean | null>(null); // null = follow the route
  const open = override ?? inside;
  const setOpen = (f: (o: boolean) => boolean) => setOverride(f(open));
  return (
    <div className="mt-2 border-t pt-2" data-testid="growth-nav">
      <button type="button" aria-expanded={open} aria-controls="growth-nav-list" onClick={() => setOpen((o) => !o)} data-testid="growth-nav-toggle"
        className={cn("flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-start text-sm font-semibold hover:bg-accent", inside && "text-primary")}>
        <TrendingUp className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="flex-1">{t("growth.nav.group")}</span><ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <ul id="growth-nav-list" className="mt-1 flex flex-col gap-0.5 ps-3" aria-label={t("growth.nav.group")}>
          {GROWTH_SECTIONS.map(({ key, to, icon: Icon, status, phase }) => (
            <li key={key}>
              <NavLink to={to} end={to === "/growth"} data-testid={`growth-nav-${key}`} className={({ isActive }) => cn("flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium hover:bg-accent", isActive && "bg-accent text-accent-foreground ring-1 ring-pulse/40")}>
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="flex-1 leading-tight">{t(`growth.sections.${key}.nav`)}</span>
                {status === "planned" && <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground" title={t("growth.planned.badge", { phase })}>P{phase}</span>}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
