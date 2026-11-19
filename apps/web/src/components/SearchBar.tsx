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
      <form onSubmit={submit} role="search" aria-label={t("search.label")} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search.placeholder")} aria-label={t("search.label")} className="h-12 ps-12 text-base" autoFocus={autoFocus} data-testid="search-input" />
        </div>
        <Button type="submit" size="lg" data-testid="search-submit">{t("search.submit")}</Button>
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
      <div className="flex gap-2">
        {(data ?? []).map((s) => (
          <button key={s.code} type="button" className="kx-chip shrink-0" aria-pressed={active === s.code} onClick={() => onPick(active === s.code ? undefined : s.code)} data-testid={`chip-${s.code}`}>
            {pick(s, "name", i18n.language)}
          </button>
        ))}
      </div>
    </div>
  );
}
