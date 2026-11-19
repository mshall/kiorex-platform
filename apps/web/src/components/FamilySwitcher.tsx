import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePatient } from "@/hooks/usePatient";

export function FamilySwitcher({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { patients, selectedId, setSelectedId } = usePatient();
  if (patients.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} role="radiogroup" aria-label={t("family.switcher")} data-testid="family-switcher">
      <Users className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      {patients.map((p) => (
        <button key={p.id} type="button" role="radio" aria-checked={p.id === selectedId} data-active={p.id === selectedId} className="kx-chip" onClick={() => setSelectedId(p.id)}>
          {p.relationship === "self" ? t("family.me") : p.name}
        </button>
      ))}
    </div>
  );
}
