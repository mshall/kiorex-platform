import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, Clock, Minus, Pill, Plus, Search, ShieldCheck, ShoppingBag, ShoppingCart, Store, Trash2, Truck } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/api/errors";
import { useCart, useClearCart, useCreateOrder, useMedicineSearch, usePharmacies, usePrescriptions, usePutCart, usePutDelivery, type CatalogueItem, type Pharmacy } from "@/api/services";
import { CardSkeleton, EmptyState, ErrorState, MockNotice, UnavailableState } from "@/components/states";
import { useFeature } from "@/hooks/useFeature";
import { formatMinor } from "@/lib/format";
import { cn } from "@/lib/utils";
import { IconTile, PageHeader, Row, SegmentedControl, StatusChip } from "@/components/kit";

const errMsg = (e: unknown, t: (k: string) => string) => (e instanceof ApiError ? (e.isFeatureDisabled ? t("unavailable.title") : e.code === "RX_REQUIRED" || e.code === "PRESCRIPTION_REQUIRED" ? t("pharmacy.errors.rx") : e.code === "ITEM_UNAVAILABLE" || e.code === "OUT_OF_STOCK" ? t("pharmacy.errors.stock") : t("pharmacy.errors.generic")) : t("pharmacy.errors.generic"));

const Num = ({ n }: { n: number }) => <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground kx-label-num" aria-hidden="true">{n}</span>;

function PharmacyPicker({ value, onChange }: { value?: string; onChange: (p: Pharmacy) => void }) {
  const { t, i18n } = useTranslation();
  const q = usePharmacies();
  if (q.isLoading) return <CardSkeleton rows={1} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data?.length) return <EmptyState icon={<Store className="h-10 w-10" aria-hidden="true" />} title={t("pharmacy.noPharmacies")} hint={t("pharmacy.noPharmaciesHint")} />;
  return (
    <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t("pharmacy.choose")} data-testid="pharmacy-list">
      {q.data.map((p) => {
        const on = value === p.id;
        return (
          <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(p)} className={cn("kx-card kx-card-interactive flex w-full items-start gap-3 p-4 text-start", on && "border-primary bg-accent ring-1 ring-primary")} data-testid="pharmacy-option">
            <IconTile tone={on ? "brand" : "neutral"} className={on ? "bg-primary text-primary-foreground" : ""}>{on ? <Check /> : <Store />}</IconTile>
            <span className="min-w-0 space-y-1.5">
              <span className="block font-semibold leading-snug">{p.name}</span>
              <span className="flex flex-wrap gap-1.5">
                {p.pickup && <StatusChip tone="neutral" dot={false}><Store className="h-3 w-3" aria-hidden="true" />{t("pharmacy.pickup")}</StatusChip>}
                {p.deliveryEnabled && <StatusChip tone="info" dot={false}><Truck className="h-3 w-3" aria-hidden="true" />{t("pharmacy.delivery")} · <span className="kx-label-num">{formatMinor(p.deliveryFeeMinor, i18n.language)}</span></StatusChip>}
                {!!p.prepMinutes && <StatusChip tone="success" dot={false}><Clock className="h-3 w-3" aria-hidden="true" />{t("pharmacy.prep", { min: p.prepMinutes })}</StatusChip>}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function CartPanel({ pharmacy }: { pharmacy?: Pharmacy }) {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const cart = useCart();
  const put = usePutCart();
  const clear = useClearCart();
  const deliv = usePutDelivery();
  const order = useCreateOrder();
  const rx = usePrescriptions();
  const [rxId, setRxId] = useState("");
  const [addr, setAddr] = useState({ line1: "", area: "", governorate: "", notes: "", phone: "" });
  const c = cart.data;
  if (cart.isLoading) return <CardSkeleton rows={1} />;
  if (cart.error && !(cart.error instanceof ApiError && cart.error.isFeatureDisabled)) return <ErrorState error={cart.error} onRetry={() => void cart.refetch()} />;
  if (!c || c.items.length === 0 || !c.pharmacyId) return <div className="kx-card flex flex-col items-center gap-2 px-5 py-8 text-center text-sm text-muted-foreground" data-testid="cart-empty"><IconTile><ShoppingBag /></IconTile><p className="font-medium text-foreground">{t("pharmacy.cartEmpty")}</p><p>{t("p3.cartEmptyHint")}</p></div>;
  const setQty = (sku: string, qty: number) => put.mutate({ pharmacyId: c.pharmacyId!, items: c.items.map((i) => ({ sku: i.sku, qty: i.sku === sku ? qty : i.qty })).filter((i) => i.qty > 0), ...(c.prescriptionRecordId ? { prescriptionRecordId: c.prescriptionRecordId } : {}) }, { onError: (e) => toast.error(errMsg(e, t)) });
  const method = c.deliveryMethod;
  const addrOk = method === "PICKUP" || addr.line1.trim().length > 2;
  const needRx = c.rxRequired && !rxId && !c.prescriptionRecordId;
  const place = () => {
    const go = () => order.mutate(rxId || c.prescriptionRecordId ? { prescriptionRecordId: rxId || c.prescriptionRecordId! } : {}, { onSuccess: (o) => nav(`/pharmacy/orders/${o.id}`), onError: (e) => toast.error(errMsg(e, t)) });
    if (method === "DELIVERY") deliv.mutate({ method, address: { line1: addr.line1.trim(), ...(addr.area && { area: addr.area }), ...(addr.governorate && { governorate: addr.governorate }), ...(addr.notes && { notes: addr.notes }), ...(addr.phone && { phone: addr.phone }) } }, { onSuccess: go, onError: (e) => toast.error(errMsg(e, t)) });
    else go();
  };
  const chooseMethod = (m: "PICKUP" | "DELIVERY") => m === "PICKUP" ? deliv.mutate({ method: m }, { onError: (e) => toast.error(errMsg(e, t)) }) : deliv.mutate({ method: m, address: { line1: addr.line1.trim() || "-" } }, { onError: (e) => toast.error(errMsg(e, t)) });
  return (
    <section className="kx-card space-y-4 p-5 max-lg:border-0 max-lg:p-0 max-lg:shadow-none" aria-labelledby="cart-h" data-testid="cart">
      <div className="flex items-center justify-between"><h2 id="cart-h" className="flex items-center gap-2 text-lg"><ShoppingCart className="h-5 w-5 text-primary" aria-hidden="true" />{t("pharmacy.cart")}<span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-primary kx-label-num">{c.items.reduce((n, i) => n + i.qty, 0)}</span></h2><Button variant="ghost" size="sm" onClick={() => clear.mutate()} disabled={clear.isPending}>{t("pharmacy.clear")}</Button></div>
      <ul className="divide-y">
        {c.items.map((i) => (
          <li key={i.sku} className="flex items-center justify-between gap-3 py-3" data-testid="cart-line">
            <div className="min-w-0 space-y-1"><p className="truncate font-medium">{i.name}</p><p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground"><span className="kx-label-num">{formatMinor(i.unitPriceMinor, i18n.language)}</span>{i.rxRequired && <StatusChip tone="warning" dot={false}>{t("pharmacy.rx")}</StatusChip>}{!i.available && <StatusChip tone="danger">{t("pharmacy.unavailable")}</StatusChip>}</p></div>
            <div className="flex items-center rounded-full border bg-card p-0.5">
              <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full" aria-label={t("pharmacy.less", { name: i.name })} onClick={() => setQty(i.sku, i.qty - 1)} disabled={put.isPending}>{i.qty === 1 ? <Trash2 aria-hidden="true" /> : <Minus aria-hidden="true" />}</Button>
              <span className="w-7 text-center text-sm font-semibold kx-label-num" aria-live="polite">{i.qty}</span>
              <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full" aria-label={t("pharmacy.more", { name: i.name })} onClick={() => setQty(i.sku, i.qty + 1)} disabled={put.isPending || i.qty >= 10}><Plus aria-hidden="true" /></Button>
            </div>
          </li>
        ))}
      </ul>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold">{t("pharmacy.deliveryChoice")}</legend>
        <SegmentedControl label={t("pharmacy.deliveryChoice")} value={method as "PICKUP" | "DELIVERY" | undefined} onChange={chooseMethod} options={[
          { value: "PICKUP", label: t("pharmacy.pickup"), icon: <Store />, hint: pharmacy?.prepMinutes ? t("pharmacy.prep", { min: pharmacy.prepMinutes }) : t("p3.free"), disabled: pharmacy ? !pharmacy.pickup : false },
          { value: "DELIVERY", label: t("pharmacy.delivery"), icon: <Truck />, hint: pharmacy ? formatMinor(pharmacy.deliveryFeeMinor, i18n.language) : undefined, disabled: pharmacy ? !pharmacy.deliveryEnabled : false, testId: "method-delivery" },
        ]} />
        {method === "DELIVERY" && (
          <div className="grid gap-3 sm:grid-cols-2" data-testid="address-form">
            <div className="space-y-1 sm:col-span-2"><Label htmlFor="a-line">{t("pharmacy.addr.line1")}</Label><Input id="a-line" value={addr.line1} maxLength={200} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} autoComplete="street-address" /></div>
            <div className="space-y-1"><Label htmlFor="a-area">{t("pharmacy.addr.area")}</Label><Input id="a-area" value={addr.area} maxLength={80} onChange={(e) => setAddr({ ...addr, area: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="a-gov">{t("pharmacy.addr.governorate")}</Label><Input id="a-gov" value={addr.governorate} maxLength={80} onChange={(e) => setAddr({ ...addr, governorate: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="a-phone">{t("pharmacy.addr.phone")}</Label><Input id="a-phone" dir="ltr" inputMode="tel" value={addr.phone} maxLength={32} onChange={(e) => setAddr({ ...addr, phone: e.target.value })} autoComplete="tel" /></div>
            <div className="space-y-1"><Label htmlFor="a-notes">{t("pharmacy.addr.notes")}</Label><Input id="a-notes" value={addr.notes} maxLength={200} onChange={(e) => setAddr({ ...addr, notes: e.target.value })} /></div>
          </div>
        )}
      </fieldset>

      {c.rxRequired && (
        <div className="space-y-2 rounded-2xl border border-warning/40 bg-warning-soft p-4" data-testid="rx-picker">
          <Label htmlFor="rx-sel" className="font-semibold text-warning">{t("pharmacy.rxNeeded")}</Label>
          <p className="text-sm">{t("pharmacy.rxHint")}</p>
          {rx.data && rx.data.length > 0 ? (
            <select id="rx-sel" value={rxId || c.prescriptionRecordId || ""} onChange={(e) => setRxId(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm" data-testid="rx-select">
              <option value="">{t("pharmacy.rxChoose")}</option>
              {rx.data.map((r) => <option key={r.id} value={r.id}>{r.title ?? t("records.kind.PRESCRIPTION")}</option>)}
            </select>
          ) : <p className="text-sm font-medium">{t("pharmacy.rxNone")} <Link to="/records?tab=prescriptions" className="text-ocean underline">{t("records.tabs.prescriptions")}</Link></p>}
        </div>
      )}

      <dl className="border-t pt-2">
        <Row label={t("pharmacy.subtotal")}>{formatMinor(c.subtotalMinor, i18n.language)}</Row>
        <Row label={t("pharmacy.deliveryFee")}>{c.deliveryFeeMinor ? formatMinor(c.deliveryFeeMinor, i18n.language) : t("p3.free")}</Row>
        <Row label={t("pharmacy.total")} strong testId="cart-total">{formatMinor(c.totalMinor, i18n.language)}</Row>
      </dl>
      <Button size="lg" className="w-full" disabled={order.isPending || deliv.isPending || !addrOk || needRx || c.items.some((i) => !i.available)} onClick={place} data-testid="place-order">{order.isPending ? t("states.loading") : t("pharmacy.placeOrder")}</Button>
      <p className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />{t("pharmacy.payNote")}</p>
    </section>
  );
}

function MedicineResults({ q, pharmacy }: { q: string; pharmacy?: Pharmacy }) {
  const { t, i18n } = useTranslation();
  const res = useMedicineSearch(q, pharmacy?.id);
  const cart = useCart();
  const put = usePutCart();
  if (q.trim().length < 2) return <p className="text-sm text-muted-foreground">{t("pharmacy.searchHint")}</p>;
  if (res.isLoading) return <CardSkeleton rows={2} />;
  if (res.error) return <ErrorState error={res.error} onRetry={() => void res.refetch()} />;
  if (!res.data!.items.length) return <EmptyState title={t("pharmacy.noResults")} hint={t("pharmacy.noResultsHint")} />;
  const add = (m: CatalogueItem) => {
    const c = cart.data;
    const same = c?.pharmacyId === m.pharmacyId;
    const items = same ? [...(c?.items ?? []).map((i) => ({ sku: i.sku, qty: i.qty }))] : [];
    const hit = items.find((i) => i.sku === m.sku);
    if (hit) hit.qty = Math.min(10, hit.qty + 1); else items.push({ sku: m.sku, qty: 1 });
    if (!same && c?.items.length) toast.message(t("pharmacy.cartReplaced"));
    put.mutate({ pharmacyId: m.pharmacyId, items }, { onError: (e) => toast.error(errMsg(e, t)), onSuccess: () => toast.success(t("pharmacy.added")) });
  };
  return (
    <ul className="space-y-3" data-testid="medicine-list">
      {res.data!.items.map((m) => {
        const inCart = cart.data?.pharmacyId === m.pharmacyId ? cart.data.items.find((i) => i.sku === m.sku)?.qty ?? 0 : 0;
        return (
          <li key={`${m.pharmacyId}-${m.sku}`} className="kx-card flex items-center gap-3 p-4" data-testid="medicine">
            <IconTile tone={m.rxRequired ? "warning" : "brand"}><Pill /></IconTile>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-semibold leading-snug"><bdi>{m.name}</bdi></p>
              <p className="text-sm text-muted-foreground"><span dir="ltr">{[m.strength, m.form].filter(Boolean).join(" · ")}</span></p>
              <div className="flex flex-wrap gap-1.5">{m.rxRequired && <StatusChip tone="warning" dot={false}>{t("pharmacy.rx")}</StatusChip>}<StatusChip tone={m.available ? "success" : "neutral"}>{m.available ? t("pharmacy.inStock") : t("pharmacy.unavailable")}</StatusChip>{inCart > 0 && <StatusChip tone="brand" dot={false}>{t("p3.inCart", { count: inCart })}</StatusChip>}</div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2"><span className="kx-label-num text-base font-semibold">{formatMinor(m.priceMinor, i18n.language)}</span>
              <Button size="sm" variant={inCart ? "outline" : "default"} onClick={() => add(m)} disabled={!m.available || put.isPending} aria-label={t("pharmacy.addNamed", { name: m.name })} data-testid="add-to-cart"><Plus aria-hidden="true" />{t("pharmacy.add")}</Button></div>
          </li>
        );
      })}
    </ul>
  );
}

export default function PharmacyPage() {
  const { t, i18n } = useTranslation();
  const feat = useFeature("kiorex.pharmacy_orders");
  const [pharmacy, setPharmacy] = useState<Pharmacy | undefined>();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [sheet, setSheet] = useState(false);
  const cart = useCart();
  const count = cart.data?.items.reduce((n, i) => n + i.qty, 0) ?? 0;
  return (
    <div className={cn("space-y-6", !desktop && count > 0 && "pb-24")}>
      <PageHeader icon={<Pill />} title={t("pharmacy.title")} hint={t("pharmacy.intro")} actions={<Link to="/pharmacy/orders" className={cn(buttonVariants({ variant: "outline" }))} data-testid="my-orders-link">{t("pharmacy.myOrders")}</Link>} />
      <MockNotice kind="pharmacy" />
      {!feat.enabled ? <UnavailableState featureKey="kiorex.pharmacy_orders" awaiting={feat.awaiting} /> : (
        <div className="grid gap-8 lg:grid-cols-[1fr_24rem]">
          <div className="space-y-8">
            <section className="space-y-3" aria-labelledby="ph-h"><h2 id="ph-h" className="flex items-center gap-2.5 text-xl"><Num n={1} />{t("pharmacy.choose")}</h2><PharmacyPicker value={pharmacy?.id} onChange={setPharmacy} /></section>
            <section className="space-y-3" aria-labelledby="med-h">
              <h2 id="med-h" className="flex items-center gap-2.5 text-xl"><Num n={2} />{t("pharmacy.medicines")}</h2>
              <form role="search" className="kx-field-row flex gap-2" onSubmit={(e) => { e.preventDefault(); setTerm(q); }}>
                <Label htmlFor="med-q" className="sr-only">{t("pharmacy.searchLabel")}</Label>
                <div className="relative flex-1"><Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input id="med-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("pharmacy.searchPlaceholder")} className="ps-10" data-testid="medicine-search" /></div>
                <Button type="submit" data-testid="medicine-search-submit">{t("search.submit")}</Button>
              </form>
              <p className="text-xs text-muted-foreground">{t("pharmacy.controlled")}</p>
              <MedicineResults q={term} pharmacy={pharmacy} />
            </section>
          </div>
          {desktop ? <aside className="lg:sticky lg:top-20 lg:self-start" aria-label={t("pharmacy.cart")}><h2 className="sr-only">{t("pharmacy.cart")}</h2><CartPanel pharmacy={pharmacy} /></aside> : (
            <>
              {count > 0 && (
                <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-12px_hsl(var(--foreground)/0.25)] backdrop-blur" data-testid="cart-bar">
                  <Button size="lg" className="w-full justify-between" onClick={() => setSheet(true)} data-testid="open-cart"><span className="flex items-center gap-2"><ShoppingCart aria-hidden="true" />{t("p3.viewCart")} · {t("p3.cartCount", { count })}</span><span className="kx-label-num">{cart.data ? formatMinor(cart.data.totalMinor, i18n.language) : ""}</span></Button>
                </div>
              )}
              <Sheet open={sheet} onOpenChange={setSheet}>
                <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-3xl p-5 pb-8" data-testid="cart-sheet">
                  <SheetHeader className="sr-only"><SheetTitle>{t("pharmacy.cart")}</SheetTitle><SheetDescription>{t("pharmacy.payNote")}</SheetDescription></SheetHeader>
                  <CartPanel pharmacy={pharmacy} />
                </SheetContent>
              </Sheet>
            </>
          )}
        </div>
      )}
    </div>
  );
}
