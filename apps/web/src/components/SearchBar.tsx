import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isEmergencyQuery } from "@/lib/emergency";
import { mapKeywordToSpecialty, track } from "@/lib/analytics";
import { useSpecialties } from "@/api/hooks";
import { pick } from "@/lib/format";
import { EmergencyBanner } from "./EmergencyBanner";
import { SpecialtyIcon } from "./SpecialtyIcon";

export function SearchBar({ initialQ = "", autoFocus }: { initialQ?: string; autoFocus?: boolean }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [q, setQ] = useState(initialQ);
  const [emergency, setEmergency] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (isEmergencyQuery(q)) { setEmergency(true); nav(`/search?q=${encodeURIComponent(q.trim())}`); return; } // KXMDS06: guidance only, no booking; no analytics event
    setEmergency(false);
    track("search_started", { specialtyCode: mapKeywordToSpecialty(q) });
    nav(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : "/search");
  };
  return (
    <div className="space-y-4">
      <form onSubmit={submit} role="search" aria-label={t("search.label")} className="flex gap-2 rounded-2xl border bg-card p-1.5 shadow-card focus-within:border-primary/60 focus-within:ring-[3px] focus-within:ring-ring/40">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute inset-s-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search.placeholder")} aria-label={t("search.label")} className="h-12 border-0 bg-transparent ps-12 text-base shadow-none focus-visible:ring-0 focus-visible:ring-offset-0" autoFocus={autoFocus} data-testid="search-input" />
        </div>
        <Button type="submit" size="lg" className="rounded-xl" data-testid="search-submit">{t("search.submit")}</Button>
      </form>
      {emergency && <EmergencyBanner />}
    </div>
  );
}

export function SpecialtyChips({ active, onPick }: { active?: string; onPick: (code: string | undefined) => void }) {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useSpecialties();
  if (isLoading) return <div className="h-11" aria-hidden="true" />;
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1" role="group" aria-label={t("search.specialties")}>
      <div className="flex gap-2 rounded-2xl border bg-card p-1.5 shadow-card focus-within:border-primary/60 focus-within:ring-[3px] focus-within:ring-ring/40">
        {[...(data ?? [])].sort((a, b) => pick(a, "name", i18n.language).localeCompare(pick(b, "name", i18n.language), i18n.language)).map((s) => (
          <button key={s.code} type="button" className="kx-chip shrink-0" aria-pressed={active === s.code} onClick={() => onPick(active === s.code ? undefined : s.code)} data-testid={`chip-${s.code}`}>
            <SpecialtyIcon code={s.code} className="h-[18px] w-[18px] text-primary" />{pick(s, "name", i18n.language)}
          </button>
        ))}
      </div>
    </div>
  );
}
