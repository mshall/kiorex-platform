import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Building2, Check, FlaskConical, Home, Search, ShieldCheck, TestTube2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/api/errors";
import { useBookLab, useLabSlots, useLabTests, type LabSlot, type LabTest } from "@/api/services";
import { CardSkeleton, EmptyState, ErrorState, MockNotice, UnavailableState } from "@/components/states";
import { useFeature } from "@/hooks/useFeature";
import { dayKey, formatDay, formatDayLong, formatMinor, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { IconTile, PageHeader, Row, SegmentedControl, StatusChip } from "@/components/kit";

const errMsg = (e: unknown, t: (k: string) => string) => (e instanceof ApiError ? (e.isFeatureDisabled ? t("unavailable.title") : e.code === "SLOT_TAKEN" || e.code === "SLOT_UNAVAILABLE" ? t("lab.errors.slot") : t("lab.errors.generic")) : t("lab.errors.generic"));

export default function LabPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const nav = useNavigate();
  const feat = useFeature("kiorex.lab_bookings");
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const tests = useLabTests(term);
  const book = useBookLab();
  const [picked, setPicked] = useState<LabTest[]>([]);
  const [collection, setCollection] = useState<"HOME" | "WALK_IN">("HOME");
  const [slot, setSlot] = useState<LabSlot | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [addr, setAddr] = useState({ line1: "", area: "", governorate: "", notes: "", phone: "" });
  const labId = picked[0]?.labId;
  const homeOk = picked.length > 0 && picked.every((x) => x.homeCollection);
  const method = collection === "HOME" && !homeOk && picked.length ? "WALK_IN" : collection;
  const slots = useLabSlots({ labId, collectionType: method, tests: picked.map((p) => p.code) });
  const days = useMemo(() => {
    const m = new Map<string, LabSlot[]>();
    for (const s of slots.data?.slots ?? []) { const k = dayKey(s.startsAt); m.set(k, [...(m.get(k) ?? []), s]); }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [slots.data]);
  const activeDay = day ?? days[0]?.[0] ?? null;
  const dayList = days.find(([k]) => k === activeDay)?.[1] ?? [];
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [sheet, setSheet] = useState(false);
  const [shown, setShown] = useState(8);
  const total = picked.reduce((n, p) => n + p.priceMinor, 0);

  const toggle = (x: LabTest) => {
    setSlot(null);
    setPicked((cur) => {
      if (cur.some((p) => p.code === x.code && p.labId === x.labId)) return cur.filter((p) => !(p.code === x.code && p.labId === x.labId));
      if (cur.length && cur[0].labId !== x.labId) { toast.message(t("lab.sameLab")); return [x]; }
      return [...cur, x];
    });
  };
  const addrOk = method === "WALK_IN" || addr.line1.trim().length > 2;
  const submit = () => {
    if (!labId || !slot) return;
    book.mutate({ labId, testCodes: picked.map((p) => p.code), collectionType: method, slot: { startsAt: slot.startsAt, endsAt: slot.endsAt }, ...(method === "HOME" ? { address: { line1: addr.line1.trim(), ...(addr.area && { area: addr.area }), ...(addr.governorate && { governorate: addr.governorate }), ...(addr.notes && { notes: addr.notes }), ...(addr.phone && { phone: addr.phone }) } } : {}) }, {
      onSuccess: (b) => nav(`/lab/bookings/${b.id}`), onError: (e) => toast.error(errMsg(e, t)),
    });
  };

  const summary = (
    <section className="kx-card space-y-4 p-5 max-lg:border-0 max-lg:p-0 max-lg:shadow-none" aria-labelledby="lab-sum" data-testid="lab-summary">
              <h2 id="lab-sum" className="text-lg">{t("lab.yourBooking")}</h2>
              {picked.length === 0 ? <p className="text-sm text-muted-foreground">{t("lab.pickHint")}</p> : (
                <>
                  <ul className="text-sm">{picked.map((p) => <li key={p.code} className="flex justify-between py-1"><span>{p.name}</span><span className="kx-label-num">{formatMinor(p.priceMinor, lang)}</span></li>)}</ul>
                  <fieldset className="space-y-2"><legend className="text-sm font-semibold">{t("lab.collection")}</legend>
                    <SegmentedControl label={t("lab.collection")} value={method} onChange={(v) => { setCollection(v); setSlot(null); }} options={[
                      { value: "HOME", label: t("lab.home"), icon: <Home />, disabled: !homeOk, testId: "collect-home" },
                      { value: "WALK_IN", label: t("lab.walkIn"), icon: <Building2 /> },
                    ]} />
                    {!homeOk && <p className="text-xs text-muted-foreground">{t("lab.homeUnavailable")}</p>}
                  </fieldset>
                  <div className="space-y-2" data-testid="lab-slots">
                    <p className="text-sm font-semibold">{t("lab.pickSlot")}</p>
                    {slots.isLoading ? <CardSkeleton rows={1} /> : slots.error ? <ErrorState error={slots.error} onRetry={() => void slots.refetch()} /> : days.length === 0 ? <p className="text-sm text-muted-foreground">{t("lab.noSlots")}</p> : (
                      <>
                        <div className="-mx-1 flex gap-2 overflow-x-auto px-1">{days.map(([k, l]) => <button key={k} type="button" aria-pressed={activeDay === k} className={cn("min-h-12 shrink-0 rounded-xl border px-4 text-sm font-medium transition-colors", activeDay === k ? "border-primary bg-primary text-primary-foreground shadow-card" : "bg-card hover:bg-accent")} onClick={() => { setDay(k); setSlot(null); }}>{formatDay(l[0].startsAt, lang)}</button>)}</div>
                        <p className="text-xs text-muted-foreground">{dayList[0] ? formatDayLong(dayList[0].startsAt, lang) : ""}</p>
                        <div className="flex flex-wrap gap-2" role="group" aria-label={t("doctor.times")}>{dayList.map((s) => <button key={s.startsAt} type="button" aria-pressed={slot?.startsAt === s.startsAt} className={cn("kx-slot min-h-11 rounded-xl border px-3.5 text-sm kx-label-num", slot?.startsAt === s.startsAt ? "border-pulse bg-pulse/15 font-semibold ring-1 ring-pulse" : "bg-card hover:bg-accent")} onClick={() => setSlot(s)} data-testid="lab-slot"><span dir="ltr">{formatTime(s.startsAt, lang)}</span></button>)}</div>
                      </>
                    )}
                  </div>
                  {method === "HOME" && (
                    <div className="space-y-2" data-testid="lab-address">
                      <div className="space-y-1"><Label htmlFor="l-line">{t("pharmacy.addr.line1")}</Label><Input id="l-line" value={addr.line1} maxLength={200} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} autoComplete="street-address" /></div>
                      <div className="grid grid-cols-2 gap-2"><div className="space-y-1"><Label htmlFor="l-area">{t("pharmacy.addr.area")}</Label><Input id="l-area" value={addr.area} maxLength={80} onChange={(e) => setAddr({ ...addr, area: e.target.value })} /></div><div className="space-y-1"><Label htmlFor="l-phone">{t("pharmacy.addr.phone")}</Label><Input id="l-phone" dir="ltr" inputMode="tel" value={addr.phone} maxLength={32} onChange={(e) => setAddr({ ...addr, phone: e.target.value })} autoComplete="tel" /></div></div>
                    </div>
                  )}
                  <dl className="border-t pt-2"><Row label={t("pharmacy.total")} strong>{formatMinor(total, lang)}</Row></dl>
                  <Button size="lg" className="w-full" disabled={!slot || !addrOk || book.isPending} onClick={submit} data-testid="lab-book">{book.isPending ? t("states.loading") : t("lab.book")}</Button>
                  <p className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />{t("lab.payNote")}</p>
                </>
              )}
            </section>
  );

  return (
    <div className={cn("space-y-6", !desktop && picked.length > 0 && "pb-24")}>
      <div>
        <PageHeader className="mb-0" icon={<FlaskConical />} title={t("lab.title")} hint={t("lab.intro")} actions={<Link to="/lab/bookings" className={cn(buttonVariants({ variant: "outline" }))} data-testid="my-lab-link">{t("lab.myBookings")}</Link>} />
      </div>
      <MockNotice kind="lab" />
      {!feat.enabled ? <UnavailableState featureKey="kiorex.lab_bookings" awaiting={feat.awaiting} /> : (
        <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
          <div className="space-y-4">
            <h2 className="text-xl">{t("lab.tests")}</h2>
            <form role="search" className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
              <Label htmlFor="lab-q" className="sr-only">{t("lab.searchLabel")}</Label>
              <Input id="lab-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("lab.searchPlaceholder")} data-testid="lab-search" />
              <Button type="submit"><Search aria-hidden="true" />{t("search.submit")}</Button>
            </form>
            {tests.isLoading ? <CardSkeleton rows={2} /> : tests.error ? <ErrorState error={tests.error} onRetry={() => void tests.refetch()} /> : !tests.data!.items.length ? <EmptyState icon={<TestTube2 className="h-10 w-10" aria-hidden="true" />} title={t("lab.noTests")} hint={t("lab.noTestsHint")} /> : (
              <>
              <ul className="space-y-3" data-testid="lab-test-list">
                {tests.data!.items.slice(0, shown).map((x) => {
                  const on = picked.some((p) => p.code === x.code && p.labId === x.labId);
                  return (
                    <li key={`${x.labId}-${x.code}`} className={cn("kx-card kx-card-interactive flex items-start gap-3 p-4", on && "border-primary bg-accent/60 ring-1 ring-primary")} data-testid="lab-test">
                      <IconTile tone={on ? "brand" : "neutral"} className={on ? "bg-primary text-primary-foreground" : ""}>{on ? <Check /> : <TestTube2 />}</IconTile>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-start justify-between gap-3"><Label htmlFor={`t-${x.labId}-${x.code}`} className="cursor-pointer text-base font-semibold leading-snug" >{x.name}</Label><span className="kx-label-num shrink-0 text-base font-semibold">{formatMinor(x.priceMinor, lang)}</span></div>
                        <p className="text-sm text-muted-foreground">{x.labName}{x.sampleType ? <> · <span className="capitalize">{x.sampleType}</span></> : null}</p>
                        <div className="flex flex-wrap gap-1.5">{x.homeCollection && <StatusChip tone="info" dot={false}><Home className="h-3 w-3" aria-hidden="true" />{t("lab.homeAvailable")}</StatusChip>}{x.preparation && <StatusChip tone="warning" dot={false}>{t("lab.prep")}: {x.preparation}</StatusChip>}</div>
                      </div>
                      <Checkbox id={`t-${x.labId}-${x.code}`} checked={on} onCheckedChange={() => toggle(x)} className="mt-1" />
                    </li>
                  );
                })}
              </ul>
              {tests.data!.items.length > shown && <div className="flex justify-center"><Button variant="outline" onClick={() => setShown((n) => n + 12)} data-testid="lab-more">{t("p3.showMore", { count: tests.data!.items.length - shown })}</Button></div>}
              </>
            )}
          </div>

          {desktop ? <aside className="lg:sticky lg:top-20 lg:self-start" aria-label={t("lab.yourBooking")}>{summary}</aside> : (
            <>
              {picked.length > 0 && <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-12px_hsl(var(--foreground)/0.25)] backdrop-blur-sm" data-testid="lab-bar"><Button size="lg" className="w-full justify-between" onClick={() => setSheet(true)} data-testid="open-lab-summary"><span>{t("lab.yourBooking")} · {t("p3.testsCount", { count: picked.length })}</span><span className="kx-label-num">{formatMinor(total, lang)}</span></Button></div>}
              <Sheet open={sheet} onOpenChange={setSheet}><SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-3xl p-5 pb-8" data-testid="lab-sheet"><SheetHeader className="sr-only"><SheetTitle>{t("lab.yourBooking")}</SheetTitle><SheetDescription>{t("lab.payNote")}</SheetDescription></SheetHeader>{summary}</SheetContent></Sheet>
            </>
          )}
        </div>
      )}
    </div>
  );
}
