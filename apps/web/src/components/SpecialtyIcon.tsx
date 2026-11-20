import type { ReactNode } from "react";
import { normalizeSpecialty } from "@/lib/specialties";
import { cn } from "@/lib/utils";

/** Per-specialty icon set (Q11 P3). One 24 px grid, 1.75 stroke, round caps/joins, brand ramps: the body strokes in the current colour (indigo),
 *  a secondary detail in Ocean and one small Coral accent (never the only carrier of meaning). Drawn in-house, no stock art. */
const O = "stroke-ocean", C = "stroke-pulse";
const ICONS: Record<string, ReactNode> = {
  general_medicine: <><path d="M6 3v5.5a4 4 0 008 0V3" /><path d="M10 12.5V15a4.5 4.5 0 009 0v-1.5" className={O} /><circle cx="19" cy="11.5" r="2" className={C} /></>,
  pediatrics: <><circle cx="12" cy="13" r="7.5" /><path d="M9.5 13v.2M14.5 13v.2" className={O} /><path d="M9.8 16.2c1.3 1.1 3.1 1.1 4.4 0" className={O} /><path d="M12 5.5C12 3.8 13 3 14.5 3" className={C} /></>,
  dermatology: <><path d="M3.5 8c2.2-1.6 3.8 1.6 6 0s3.8 1.6 6 0 3.8 1.6 5 .6" /><path d="M3.5 13c2.2-1.6 3.8 1.6 6 0s3.8 1.6 6 0 3.8 1.6 5 .6" className={O} /><path d="M12 21c-1.6 0-2.5-1.1-2.5-2.3 0-1.4 2.5-3.7 2.5-3.7s2.5 2.3 2.5 3.7c0 1.2-.9 2.3-2.5 2.3z" className={C} /></>,
  dentistry: <><path d="M7.5 3.5C5 3.5 3.8 5.7 4.3 8.5c.4 2.2 1.2 3.5 1.5 6 .3 2.4.8 6 2.2 6 1.2 0 1.3-3.4 2-5 .4-.9 1.2-.9 1.6 0 .7 1.6.8 5 2 5 1.4 0 1.9-3.6 2.2-6 .3-2.5 1.1-3.8 1.5-6 .5-2.8-.7-5-3.2-5-1.8 0-2.3.8-4.1.8S9.300 3.500 7.500 3.500z" /><path d="M8.500 7.500c.8.5 1.700.7 2.500.7" className={C} /></>,
  cardiology: <><path d="M12 20.5S4.500 16 4.500 10A4.200 4.200 0 0112 7.800 4.200 4.200 0 0119.500 10c0 6-7.500 10.500-7.500 10.500z" /><path d="M6.500 12.500h3l1.500-3 2.200 5 1.500-2h2.800" className={C} /></>,
  obstetrics_gynecology: <><circle cx="12" cy="9" r="5" /><path d="M12 14v7M9 18h6" className={O} /><circle cx="12" cy="9" r=".6" className={C} /></>,
  ent: <><path d="M7.500 10.500a4.500 4.500 0 119 0c0 2.800-2.200 3.300-2.200 5.700a2.800 2.800 0 01-5.600 0" /><path d="M10.800 10.500a1.200 1.200 0 112.400 0c0 1-1.200 1.300-1.200 2.300" className={O} /><path d="M19.500 6.500c.8.800 1.200 1.800 1.200 3" className={C} /></>,
  ophthalmology: <><path d="M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12z" /><circle cx="12" cy="12" r="3.200" className={O} /><circle cx="13" cy="11" r=".7" className={C} /></>,
  orthopedics: <><path d="M5.500 14.500a2.500 2.500 0 103.500 3.500l9-9a2.500 2.500 0 10-3.500-3.500z" /><path d="M10 14l-1.500 1.500" className={C} /></>,
  psychiatry: <><path d="M8 20v-4.200A6.500 6.500 0 1118 10.200c0 1.200-.5 1.800-1 2.800V16a1 1 0 01-1 1h-2.500V20" /><path d="M11 9.500a2 2 0 013.200 1.600c0 1.500-2.200 1.500-2.200 3.200" className={O} /><circle cx="12" cy="16" r=".5" className={C} /></>,
  physio_therapy: <><circle cx="14.500" cy="4.500" r="2" /><path d="M12 9l-3 4.500 3.500 2V21" /><path d="M12 9l4.500 2 1.500 4.500" className={O} /><path d="M5 20.500l3-5" className={C} /></>,
  internal_medicine: <><rect x="5.500" y="4" width="13" height="17" rx="2.500" /><path d="M9.500 3h5v3h-5z" className={O} /><path d="M12 10.500v6M9 13.500h6" className={C} /></>,
  family_medicine: <><circle cx="8.500" cy="8" r="2.500" /><circle cx="16.500" cy="9.500" r="2" className={O} /><path d="M3.500 19c0-3 2-5 5-5s5 2 5 5M14 19c0-2.200 1.200-3.800 3-3.800s3 1.400 3 3.800" /><path d="M12 5.500c0-1 .8-1.500 1.500-1.500" className={C} /></>,
  urology: <><path d="M9 3.500C5.800 3.500 4 6.500 4 10c0 4 2.200 10.500 5.200 10.500 2.200 0 2-2.300 2.300-3.700.3-1.200 1.200-1.800 3-1.800 2.300 0 3.500-1.200 3.500-3.200 0-3.600-3.500-8.300-9-8.300z" /><path d="M12.500 8.500c-.8 1-.8 2 0 3" className={C} /></>,
  nursing: <><path d="M3.500 11.500L12 4l8.500 7.500" /><path d="M5.500 10v10h13V10" /><path d="M12 12.800v4.500M9.800 15h4.400" className={C} /></>,
  laboratory: <><path d="M9 3h6M10 3v6.200l-4.800 8.300A2 2 0 007 20.500h10a2 2 0 001.800-3L14 9.200V3" /><path d="M7.600 15h8.800" className={O} /><circle cx="12" cy="17.500" r=".6" className={C} /></>,
  radiology: <><rect x="4" y="3.500" width="16" height="17" rx="2.500" /><path d="M12 7v10" className={O} /><path d="M8.300 9.500c2.300.6 5.100.6 7.400 0M8.300 13c2.300.6 5.100.6 7.400 0" className={O} /><circle cx="12" cy="6" r=".5" className={C} /></>,
  aesthetics: <><path d="M10.500 4l1.800 5.200 5.200 1.800-5.200 1.800-1.800 5.200-1.800-5.200L3.500 11l5.200-1.800z" /><path d="M18 15.500l.7 1.800 1.800.7-1.800.7-.7 1.800-.7-1.800-1.800-.7 1.800-.7z" className={C} /></>,
  pain_management: <><circle cx="12" cy="12" r="8.500" /><path d="M13 6.500L9 12.500h3.500L11 17.500l4.500-6.500H12z" className={C} /></>,
  polyclinic: <><rect x="4" y="5" width="10" height="15" rx="1.500" /><path d="M14 11h4.500a1.500 1.500 0 011.500 1.500V20" className={O} /><path d="M9 9v5M6.500 11.500h5" className={C} /></>,
  other: <><circle cx="12" cy="12" r="8.500" /><path d="M8.500 12h.01M12 12h.01M15.500 12h.01" className={O} strokeWidth="2.500" /></>,
};

export function SpecialtyIcon({ code, className }: { code?: string | null; className?: string }) {
  const k = code ? normalizeSpecialty(code) : "other";
  const node = ICONS[k === "home_nursing" ? "nursing" : k] ?? ICONS.other;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={cn("h-5 w-5 shrink-0", className)} aria-hidden="true" focusable="false" data-specialty-icon={k}>{node}</svg>
  );
}

/** Soft tile around the icon (indigo on the accent tint). */
export function SpecialtyTile({ code, className, size = "md" }: { code?: string | null; className?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-xl bg-accent text-primary", size === "sm" ? "h-8 w-8 [&_svg]:h-4 [&_svg]:w-4" : size === "lg" ? "h-14 w-14 [&_svg]:h-7 [&_svg]:w-7" : "h-11 w-11 [&_svg]:h-6 [&_svg]:w-6", className)}>
      <SpecialtyIcon code={code} />
    </span>
  );
}
