import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FlaskConical, Home, Search, TestTube2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><FlaskConical className="h-7 w-7 text-ocean" aria-hidden="true" /><h1 className="text-2xl">{t("lab.title")}</h1></div>
        <Link to="/lab/bookings" className={cn(buttonVariants({ variant: "outline" }))} data-testid="my-lab-link">{t("lab.myBookings")}</Link>
      </div>
      <p className="max-w-2xl text-muted-foreground">{t("lab.intro")}</p>
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
              <ul className="space-y-3" data-testid="lab-test-list">
                {tests.data!.items.map((x) => {
                  const on = picked.some((p) => p.code === x.code && p.labId === x.labId);
                  return (
                    <li key={`${x.labId}-${x.code}`} className="kx-card flex items-start gap-3 p-4" data-testid="lab-test">
                      <Checkbox id={`t-${x.labId}-${x.code}`} checked={on} onCheckedChange={() => toggle(x)} className="mt-1" />
                      <div className="min-w-0 flex-1"><Label htmlFor={`t-${x.labId}-${x.code}`} className="text-base font-semibold">{x.name}</Label>
                        <p className="text-sm text-muted-foreground">{x.labName} · {formatMinor(x.priceMinor, lang)}{x.sampleType ? ` · ${x.sampleType}` : ""}</p>
                        <div className="mt-1 flex flex-wrap gap-2">{x.homeCollection && <Badge variant="info">{t("lab.homeAvailable")}</Badge>}{x.preparation && <Badge variant="warning">{t("lab.prep")}: {x.preparation}</Badge>}</div></div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <aside className="lg:sticky lg:top-20 lg:self-start">
            <section className="kx-card space-y-4 p-5" aria-labelledby="lab-sum" data-testid="lab-summary">
              <h2 id="lab-sum" className="text-lg">{t("lab.yourBooking")}</h2>
              {picked.length === 0 ? <p className="text-sm text-muted-foreground">{t("lab.pickHint")}</p> : (
                <>
                  <ul className="text-sm">{picked.map((p) => <li key={p.code} className="flex justify-between py-1"><span>{p.name}</span><span className="kx-label-num">{formatMinor(p.priceMinor, lang)}</span></li>)}</ul>
                  <fieldset className="space-y-2"><legend className="text-sm font-semibold">{t("lab.collection")}</legend>
                    <div role="radiogroup" className="flex flex-wrap gap-2">
                      <button type="button" role="radio" aria-checked={method === "HOME"} data-active={method === "HOME"} disabled={!homeOk} className="kx-chip" onClick={() => { setCollection("HOME"); setSlot(null); }} data-testid="collect-home"><Home className="h-4 w-4" aria-hidden="true" />{t("lab.home")}</button>
                      <button type="button" role="radio" aria-checked={method === "WALK_IN"} data-active={method === "WALK_IN"} className="kx-chip" onClick={() => { setCollection("WALK_IN"); setSlot(null); }}>{t("lab.walkIn")}</button>
                    </div>
                    {!homeOk && <p className="text-xs text-muted-foreground">{t("lab.homeUnavailable")}</p>}
                  </fieldset>
                  <div className="space-y-2" data-testid="lab-slots">
                    <p className="text-sm font-semibold">{t("lab.pickSlot")}</p>
                    {slots.isLoading ? <CardSkeleton rows={1} /> : slots.error ? <ErrorState error={slots.error} onRetry={() => void slots.refetch()} /> : days.length === 0 ? <p className="text-sm text-muted-foreground">{t("lab.noSlots")}</p> : (
                      <>
                        <div className="-mx-1 flex gap-2 overflow-x-auto px-1">{days.map(([k, l]) => <button key={k} type="button" aria-pressed={activeDay === k} className={cn("min-h-11 shrink-0 rounded-xl border px-3 text-sm", activeDay === k ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent")} onClick={() => { setDay(k); setSlot(null); }}>{formatDay(l[0].startsAt, lang)}</button>)}</div>
                        <p className="text-xs text-muted-foreground">{dayList[0] ? formatDayLong(dayList[0].startsAt, lang) : ""}</p>
                        <div className="flex flex-wrap gap-2" role="group" aria-label={t("doctor.times")}>{dayList.map((s) => <button key={s.startsAt} type="button" aria-pressed={slot?.startsAt === s.startsAt} className={cn("min-h-11 rounded-xl border px-3 text-sm", slot?.startsAt === s.startsAt ? "border-pulse bg-pulse/15 font-semibold" : "bg-card hover:bg-accent")} onClick={() => setSlot(s)} data-testid="lab-slot"><span dir="ltr">{formatTime(s.startsAt, lang)}</span></button>)}</div>
                      </>
                    )}
                  </div>
                  {method === "HOME" && (
                    <div className="space-y-2" data-testid="lab-address">
                      <div className="space-y-1"><Label htmlFor="l-line">{t("pharmacy.addr.line1")}</Label><Input id="l-line" value={addr.line1} maxLength={200} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} autoComplete="street-address" /></div>
                      <div className="grid grid-cols-2 gap-2"><div className="space-y-1"><Label htmlFor="l-area">{t("pharmacy.addr.area")}</Label><Input id="l-area" value={addr.area} maxLength={80} onChange={(e) => setAddr({ ...addr, area: e.target.value })} /></div><div className="space-y-1"><Label htmlFor="l-phone">{t("pharmacy.addr.phone")}</Label><Input id="l-phone" dir="ltr" inputMode="tel" value={addr.phone} maxLength={32} onChange={(e) => setAddr({ ...addr, phone: e.target.value })} autoComplete="tel" /></div></div>
                    </div>
                  )}
                  <div className="flex justify-between border-t pt-3 text-base font-semibold"><span>{t("pharmacy.subtotal")}</span><span className="kx-label-num">{formatMinor(total, lang)}</span></div>
                  <Button size="lg" className="w-full" disabled={!slot || !addrOk || book.isPending} onClick={submit} data-testid="lab-book">{book.isPending ? t("states.loading") : t("lab.book")}</Button>
                  <p className="text-xs text-muted-foreground">{t("lab.payNote")}</p>
                </>
              )}
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
