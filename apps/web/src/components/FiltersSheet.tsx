import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { SearchParams } from "@/api/types";

const AREAS = ["Nasr City", "Mohandessin", "Fifth Settlement", "Maadi", "Heliopolis", "Dokki"];
const areaAr: Record<string, string> = { "Nasr City": "مدينة نصر", Mohandessin: "المهندسين", "Fifth Settlement": "التجمع الخامس", Maadi: "المعادي", Heliopolis: "مصر الجديدة", Dokki: "الدقي" };

function Seg<T extends string | number | boolean | undefined>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={String(o.v)} type="button" role="radio" aria-checked={value === o.v} data-active={value === o.v} className="kx-chip" onClick={() => onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

export function FiltersSheet({ value, onApply, activeCount }: { value: SearchParams; onApply: (p: SearchParams) => void; activeCount: number }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (open) setDraft(value); }, [open, value]);
  const set = (patch: Partial<SearchParams>) => setDraft((d) => ({ ...d, ...patch }));
  const ar = i18n.language.startsWith("ar");

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" data-testid="open-filters"><SlidersHorizontal aria-hidden="true" />{t("results.filters")}{activeCount > 0 && <span className="rounded-full bg-pulse px-2 text-xs text-pulse-foreground">{activeCount}</span>}</Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-md" data-testid="filters-sheet">
        <SheetHeader><SheetTitle>{t("results.filters")}</SheetTitle><SheetDescription>{t("results.filtersHint")}</SheetDescription></SheetHeader>
        <div className="flex-1 space-y-6 py-4">
          <div className="space-y-2"><Label>{t("filters.area")}</Label>
            <Seg label={t("filters.area")} value={draft.area ?? ""} onChange={(v) => set({ area: v })} options={[{ v: "", label: t("filters.any") }, ...AREAS.map((a) => ({ v: a, label: ar ? areaAr[a] : a }))]} /></div>
          <div className="space-y-2"><Label htmlFor="maxFee">{t("filters.maxFee")}</Label>
            <Input id="maxFee" inputMode="numeric" type="number" min={0} step={50} value={draft.maxFee ?? ""} onChange={(e) => set({ maxFee: e.target.value ? Number(e.target.value) : undefined })} placeholder={t("filters.anyFee")} /></div>
          <div className="space-y-2"><Label>{t("filters.gender")}</Label>
            <Seg label={t("filters.gender")} value={draft.gender ?? ""} onChange={(v) => set({ gender: v as SearchParams["gender"] })} options={[{ v: "", label: t("filters.any") }, { v: "F", label: t("filters.female") }, { v: "M", label: t("filters.male") }]} /></div>
          <div className="space-y-2"><Label>{t("filters.language")}</Label>
            <Seg label={t("filters.language")} value={draft.language ?? ""} onChange={(v) => set({ language: v })} options={[{ v: "", label: t("filters.any") }, { v: "ar", label: "العربية" }, { v: "en", label: "English" }]} /></div>
          <div className="space-y-2"><Label>{t("filters.rating")}</Label>
            <Seg label={t("filters.rating")} value={draft.minRating} onChange={(v) => set({ minRating: v })} options={[{ v: undefined, label: t("filters.any") }, { v: 4, label: "4+" }, { v: 4.5, label: "4.5+" }]} /></div>
          <div className="space-y-2"><Label>{t("filters.availability")}</Label>
            <Seg label={t("filters.availability")} value={draft.availableWithinDays} onChange={(v) => set({ availableWithinDays: v })} options={[{ v: undefined, label: t("filters.any") }, { v: 1, label: t("filters.today") }, { v: 3, label: t("filters.threeDays") }, { v: 7, label: t("filters.week") }]} /></div>
          <label className="flex min-h-11 items-center gap-3">
            <Checkbox checked={!!draft.acceptsDeposit} onCheckedChange={(c) => set({ acceptsDeposit: c === true })} />
            <span>{t("filters.acceptsDeposit")}</span>
          </label>
        </div>
        <SheetFooter className="gap-2 sm:flex-row">
          <Button variant="ghost" onClick={() => { setDraft({ q: value.q, specialty: value.specialty, sort: value.sort }); }}>{t("filters.reset")}</Button>
          <Button onClick={() => { onApply({ ...draft, page: 1 }); setOpen(false); }} data-testid="apply-filters">{t("filters.apply")}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
