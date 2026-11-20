import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CalendarDays, MapPin, Search, Stethoscope } from "lucide-react";
import { isEmergencyQuery } from "@/lib/emergency";
import { mapKeywordToSpecialty, track } from "@/lib/analytics";
import { useSpecialties } from "@/api/hooks";
import { pick } from "@/lib/format";
import { AREAS, areaLabel } from "@/lib/areas";
import { toQuery } from "@/lib/searchParams";
import { cn } from "@/lib/utils";
import { EmergencyBanner } from "./EmergencyBanner";

const WHEN: { v: number | ""; k: string }[] = [{ v: "", k: "filters.any" }, { v: 1, k: "filters.today" }, { v: 3, k: "filters.threeDays" }, { v: 7, k: "filters.week" }];

/** Instant search console for the hero: free text + specialty + area + when, one submit. Emergency wording never reaches booking (KXMDS06). */
export function HeroSearch({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const specialties = useSpecialties();
  const [q, setQ] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [area, setArea] = useState("");
  const [when, setWhen] = useState<number | "">("");
  const [emergency, setEmergency] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (isEmergencyQuery(q)) { setEmergency(true); nav(`/search?q=${encodeURIComponent(q.trim())}`); return; }
    setEmergency(false);
    const spec = specialty || mapKeywordToSpecialty(q);
    track("search_started", { specialtyCode: spec });
    const qs = toQuery({ q: q.trim() || undefined, specialty: specialty || undefined, area: area || undefined, availableWithinDays: when === "" ? undefined : when, sort: "earliest" }).toString();
    nav(qs ? `/search?${qs}` : "/search");
  };

  return (
    <div className={cn("space-y-3", className)}>
      <form onSubmit={submit} role="search" aria-label={t("search.label")} className="rounded-2xl border bg-card p-2 shadow-float" data-testid="hero-search">
        <div className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="kx-field sm:flex-1"><Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">{t("search.label")}</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search.placeholder")} data-testid="search-input" /></label>
          <button type="submit" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-7 text-base font-semibold text-primary-foreground shadow-xs transition-[background-color,box-shadow,transform] hover:bg-primary/90 hover:shadow-raised active:scale-[0.98] focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:active:scale-100" data-testid="search-submit">
            <Search className="h-5 w-5" aria-hidden="true" />{t("search.submit")}
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="kx-field"><Stethoscope className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">{t("search.specialty")}</span>
            <select value={specialty} onChange={(e) => setSpecialty(e.target.value)} data-testid="hero-specialty">
              <option value="">{t("search.anySpecialty")}</option>
              {(specialties.data ?? []).map((s) => <option key={s.code} value={s.code}>{pick(s, "name", i18n.language)}</option>)}
            </select></label>
          <label className="kx-field"><MapPin className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">{t("filters.area")}</span>
            <select value={area} onChange={(e) => setArea(e.target.value)} data-testid="hero-area">
              <option value="">{t("search.anyArea")}</option>
              {AREAS.map((a) => <option key={a} value={a}>{areaLabel(a, i18n.language)}</option>)}
            </select></label>
          <label className="kx-field"><CalendarDays className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">{t("filters.availability")}</span>
            <select value={when} onChange={(e) => setWhen(e.target.value ? Number(e.target.value) : "")} data-testid="hero-when">
              {WHEN.map((w) => <option key={String(w.v)} value={w.v}>{w.v === "" ? t("search.anyDate") : t(w.k)}</option>)}
            </select></label>

        </div>
        </div>
      </form>
      {emergency && <EmergencyBanner />}
    </div>
  );
}
