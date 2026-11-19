import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Minus, Pill, Plus, Search, ShoppingCart, Store, Trash2, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/api/errors";
import { useCart, useClearCart, useCreateOrder, useMedicineSearch, usePharmacies, usePrescriptions, usePutCart, usePutDelivery, type CatalogueItem, type Pharmacy } from "@/api/services";
import { CardSkeleton, EmptyState, ErrorState, MockNotice, UnavailableState } from "@/components/states";
import { useFeature } from "@/hooks/useFeature";
import { formatMinor } from "@/lib/format";
import { cn } from "@/lib/utils";

const errMsg = (e: unknown, t: (k: string) => string) => (e instanceof ApiError ? (e.isFeatureDisabled ? t("unavailable.title") : e.code === "RX_REQUIRED" || e.code === "PRESCRIPTION_REQUIRED" ? t("pharmacy.errors.rx") : e.code === "ITEM_UNAVAILABLE" || e.code === "OUT_OF_STOCK" ? t("pharmacy.errors.stock") : t("pharmacy.errors.generic")) : t("pharmacy.errors.generic"));

function PharmacyPicker({ value, onChange }: { value?: string; onChange: (p: Pharmacy) => void }) {
  const { t, i18n } = useTranslation();
  const q = usePharmacies();
  if (q.isLoading) return <CardSkeleton rows={1} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data?.length) return <EmptyState icon={<Store className="h-10 w-10" aria-hidden="true" />} title={t("pharmacy.noPharmacies")} hint={t("pharmacy.noPharmaciesHint")} />;
  return (
    <ul className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t("pharmacy.choose")} data-testid="pharmacy-list">
      {q.data.map((p) => (
        <li key={p.id}>
          <button type="button" role="radio" aria-checked={value === p.id} onClick={() => onChange(p)} className={cn("kx-card w-full space-y-1 p-4 text-start transition-colors hover:border-primary", value === p.id && "border-pulse ring-2 ring-pulse/40")} data-testid="pharmacy-option">
            <p className="font-semibold">{p.name}</p>
            <p className="text-sm text-muted-foreground">{[p.pickup && t("pharmacy.pickup"), p.deliveryEnabled && `${t("pharmacy.delivery")} ${formatMinor(p.deliveryFeeMinor, i18n.language)}`].filter(Boolean).join(" · ")}{p.prepMinutes ? ` · ${t("pharmacy.prep", { min: p.prepMinutes })}` : ""}</p>
          </button>
        </li>
      ))}
    </ul>
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
  if (!c || c.items.length === 0 || !c.pharmacyId) return <div className="kx-card p-5 text-sm text-muted-foreground" data-testid="cart-empty"><ShoppingCart className="mb-2 h-6 w-6" aria-hidden="true" />{t("pharmacy.cartEmpty")}</div>;
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
    <section className="kx-card space-y-4 p-5" aria-labelledby="cart-h" data-testid="cart">
      <div className="flex items-center justify-between"><h2 id="cart-h" className="flex items-center gap-2 text-lg"><ShoppingCart className="h-5 w-5" aria-hidden="true" />{t("pharmacy.cart")}</h2><Button variant="ghost" size="sm" onClick={() => clear.mutate()} disabled={clear.isPending}>{t("pharmacy.clear")}</Button></div>
      <ul className="divide-y">
        {c.items.map((i) => (
          <li key={i.sku} className="flex items-center justify-between gap-3 py-3" data-testid="cart-line">
            <div className="min-w-0"><p className="truncate font-medium">{i.name}</p><p className="text-sm text-muted-foreground">{formatMinor(i.unitPriceMinor, i18n.language)}{i.rxRequired && <Badge variant="warning" className="ms-2">{t("pharmacy.rx")}</Badge>}{!i.available && <Badge variant="destructive" className="ms-2">{t("pharmacy.unavailable")}</Badge>}</p></div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" aria-label={t("pharmacy.less", { name: i.name })} onClick={() => setQty(i.sku, i.qty - 1)} disabled={put.isPending}>{i.qty === 1 ? <Trash2 aria-hidden="true" /> : <Minus aria-hidden="true" />}</Button>
              <span className="w-8 text-center kx-label-num" aria-live="polite">{i.qty}</span>
              <Button variant="outline" size="icon" aria-label={t("pharmacy.more", { name: i.name })} onClick={() => setQty(i.sku, i.qty + 1)} disabled={put.isPending || i.qty >= 10}><Plus aria-hidden="true" /></Button>
            </div>
          </li>
        ))}
      </ul>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{t("pharmacy.deliveryChoice")}</legend>
        <div role="radiogroup" className="flex flex-wrap gap-2">
          <button type="button" role="radio" aria-checked={method === "PICKUP"} data-active={method === "PICKUP"} className="kx-chip" onClick={() => chooseMethod("PICKUP")} disabled={pharmacy ? !pharmacy.pickup : false}><Store className="h-4 w-4" aria-hidden="true" />{t("pharmacy.pickup")}</button>
          <button type="button" role="radio" aria-checked={method === "DELIVERY"} data-active={method === "DELIVERY"} className="kx-chip" onClick={() => chooseMethod("DELIVERY")} disabled={pharmacy ? !pharmacy.deliveryEnabled : false} data-testid="method-delivery"><Truck className="h-4 w-4" aria-hidden="true" />{t("pharmacy.delivery")}</button>
        </div>
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
        <div className="space-y-2 rounded-xl border border-warning/50 bg-warning-soft p-4" data-testid="rx-picker">
          <Label htmlFor="rx-sel" className="font-semibold">{t("pharmacy.rxNeeded")}</Label>
          <p className="text-sm">{t("pharmacy.rxHint")}</p>
          {rx.data && rx.data.length > 0 ? (
            <select id="rx-sel" value={rxId || c.prescriptionRecordId || ""} onChange={(e) => setRxId(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm" data-testid="rx-select">
              <option value="">{t("pharmacy.rxChoose")}</option>
              {rx.data.map((r) => <option key={r.id} value={r.id}>{r.title ?? t("records.kind.PRESCRIPTION")}</option>)}
            </select>
          ) : <p className="text-sm font-medium">{t("pharmacy.rxNone")} <Link to="/records?tab=prescriptions" className="text-ocean underline">{t("records.tabs.prescriptions")}</Link></p>}
        </div>
      )}

      <dl className="space-y-1 border-t pt-3 text-sm">
        <div className="flex justify-between"><dt>{t("pharmacy.subtotal")}</dt><dd className="kx-label-num">{formatMinor(c.subtotalMinor, i18n.language)}</dd></div>
        <div className="flex justify-between"><dt>{t("pharmacy.deliveryFee")}</dt><dd className="kx-label-num">{formatMinor(c.deliveryFeeMinor, i18n.language)}</dd></div>
        <div className="flex justify-between text-base font-semibold"><dt>{t("pharmacy.total")}</dt><dd className="kx-label-num" data-testid="cart-total">{formatMinor(c.totalMinor, i18n.language)}</dd></div>
      </dl>
      <Button size="lg" className="w-full" disabled={order.isPending || deliv.isPending || !addrOk || needRx || c.items.some((i) => !i.available)} onClick={place} data-testid="place-order">{order.isPending ? t("states.loading") : t("pharmacy.placeOrder")}</Button>
      <p className="text-xs text-muted-foreground">{t("pharmacy.payNote")}</p>
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
      {res.data!.items.map((m) => (
        <li key={`${m.pharmacyId}-${m.sku}`} className="kx-card flex items-center justify-between gap-3 p-4" data-testid="medicine">
          <div className="min-w-0"><p className="font-semibold">{m.name}</p><p className="text-sm text-muted-foreground">{[m.strength, m.form].filter(Boolean).join(" · ")} · {formatMinor(m.priceMinor, i18n.language)}</p>
            <div className="mt-1 flex gap-2">{m.rxRequired && <Badge variant="warning">{t("pharmacy.rx")}</Badge>}<Badge variant={m.available ? "success" : "secondary"}>{m.available ? t("pharmacy.inStock") : t("pharmacy.unavailable")}</Badge></div></div>
          <Button onClick={() => add(m)} disabled={!m.available || put.isPending} aria-label={t("pharmacy.addNamed", { name: m.name })} data-testid="add-to-cart"><Plus aria-hidden="true" />{t("pharmacy.add")}</Button>
        </li>
      ))}
    </ul>
  );
}

export default function PharmacyPage() {
  const { t } = useTranslation();
  const feat = useFeature("kiorex.pharmacy_orders");
  const [pharmacy, setPharmacy] = useState<Pharmacy | undefined>();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><Pill className="h-7 w-7 text-ocean" aria-hidden="true" /><h1 className="text-2xl">{t("pharmacy.title")}</h1></div>
        <Link to="/pharmacy/orders" className={cn(buttonVariants({ variant: "outline" }))} data-testid="my-orders-link">{t("pharmacy.myOrders")}</Link>
      </div>
      <p className="max-w-2xl text-muted-foreground">{t("pharmacy.intro")}</p>
      <MockNotice kind="pharmacy" />
      {!feat.enabled ? <UnavailableState featureKey="kiorex.pharmacy_orders" awaiting={feat.awaiting} /> : (
        <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
          <div className="space-y-5">
            <section className="space-y-3" aria-labelledby="ph-h"><h2 id="ph-h" className="text-xl">{t("pharmacy.choose")}</h2><PharmacyPicker value={pharmacy?.id} onChange={setPharmacy} /></section>
            <section className="space-y-3" aria-labelledby="med-h">
              <h2 id="med-h" className="text-xl">{t("pharmacy.medicines")}</h2>
              <form role="search" className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setTerm(q); }}>
                <Label htmlFor="med-q" className="sr-only">{t("pharmacy.searchLabel")}</Label>
                <Input id="med-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("pharmacy.searchPlaceholder")} data-testid="medicine-search" />
                <Button type="submit" data-testid="medicine-search-submit"><Search aria-hidden="true" />{t("search.submit")}</Button>
              </form>
              <p className="text-xs text-muted-foreground">{t("pharmacy.controlled")}</p>
              <MedicineResults q={term} pharmacy={pharmacy} />
            </section>
          </div>
          <aside className="lg:sticky lg:top-20 lg:self-start"><CartPanel pharmacy={pharmacy} /></aside>
        </div>
      )}
    </div>
  );
}
