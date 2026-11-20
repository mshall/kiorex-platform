import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, Eye, EyeOff, MapPin, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAddAddress, useAddresses, useConfirmAddress, useDeleteAddress, useHomeDistricts, useUpdateAddress, type Address, type AddressInput } from "@/api/home";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/states";
import { ApiError } from "@/api/errors";

const EMPTY: AddressInput = { label: "", governorate: "", district: "", street: "", building: "", floor: "", flat: "", landmark: "", makeDefault: false };
const clean = (v: AddressInput): AddressInput => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== "" && x !== undefined)) as unknown as AddressInput;

export function AddressForm({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (o: boolean) => void; editing?: Address }) {
  const { t } = useTranslation();
  const add = useAddAddress();
  const upd = useUpdateAddress();
  const districts = useHomeDistricts(open);
  const [v, setV] = useState<AddressInput>(() => (editing ? { label: editing.label, governorate: editing.governorate ?? "", district: editing.district, street: editing.street ?? "", building: editing.building ?? "", floor: editing.floor ?? "", flat: editing.flat ?? "", landmark: editing.landmark ?? "", makeDefault: editing.isDefault } : EMPTY));
  const set = (k: keyof AddressInput) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const busy = add.isPending || upd.isPending;
  const valid = v.label.trim() && v.governorate.trim() && v.district.trim() && v.street.trim();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const opts = { onSuccess: () => { toast.success(t("hv.addressSaved")); onOpenChange(false); }, onError: (err: unknown) => toast.error(err instanceof ApiError && err.status === 400 ? t("hv.addressInvalid") : t("states.errorTitle")) };
    if (editing) upd.mutate({ id: editing.id, body: clean(v) }, opts); else add.mutate(clean(v), opts);
  };
  const field = (k: keyof AddressInput, label: string, extra?: { required?: boolean; list?: string }) => (
    <div className="space-y-1"><Label htmlFor={`addr-${k}`}>{label}{extra?.required && <span aria-hidden="true"> *</span>}</Label>
      <Input id={`addr-${k}`} value={(v[k] as string) ?? ""} onChange={set(k)} required={extra?.required} list={extra?.list} autoComplete="off" data-testid={`addr-${k}`} /></div>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? t("hv.editAddress") : t("hv.addAddress")}</DialogTitle><DialogDescription>{t("hv.addressPrivacy")}</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-3" aria-label={t("hv.addressForm")}>
          <div className="grid gap-3 sm:grid-cols-2">
            {field("label", t("hv.fLabel"), { required: true })}{field("governorate", t("hv.fGovernorate"), { required: true })}
            {field("district", t("hv.fDistrict"), { required: true, list: "district-list" })}{field("street", t("hv.fStreet"), { required: true })}
            {field("building", t("hv.fBuilding"))}{field("floor", t("hv.fFloor"))}{field("flat", t("hv.fFlat"))}{field("landmark", t("hv.fLandmark"))}
          </div>
          <datalist id="district-list">{(districts.data ?? []).map((d) => <option key={d.district} value={d.district} />)}</datalist>
          <label className="flex min-h-11 items-center gap-3"><Checkbox checked={!!v.makeDefault} onCheckedChange={(c) => setV((x) => ({ ...x, makeDefault: c === true }))} /><span className="text-sm">{t("hv.makeDefault")}</span></label>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("appointment.keep")}</Button><Button type="submit" disabled={!valid || busy} data-testid="save-address">{busy ? t("states.loading") : t("hv.save")}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Row({ a, onEdit }: { a: Address; onEdit: () => void }) {
  const { t } = useTranslation();
  const [reveal, setReveal] = useState(false);
  const [del, setDel] = useState(false);
  const confirm = useConfirmAddress();
  const remove = useDeleteAddress();
  const lines = [a.street, a.building && `${t("hv.fBuilding")} ${a.building}`, a.floor && `${t("hv.fFloor")} ${a.floor}`, a.flat && `${t("hv.fFlat")} ${a.flat}`, a.landmark].filter(Boolean).join("، ");
  return (
    <li className="kx-card space-y-3 p-4" data-testid="address-row">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold"><MapPin className="h-4 w-4 text-ocean" aria-hidden="true" />{a.label}{a.isDefault && <Badge variant="info">{t("hv.default")}</Badge>}{a.confirmed ? <Badge variant="success">{t("hv.confirmedBadge")}</Badge> : <Badge variant="warning">{t("hv.unconfirmedBadge")}</Badge>}</p>
          <p className="text-sm text-muted-foreground" data-testid="address-summary">{a.summary}</p>
          {/* Masked by default: doorstep lines are only revealed on request, never in lists, logs or analytics. */}
          <p className="text-sm" data-testid="address-lines" aria-live="polite">{reveal ? (lines || "—") : "••••••••"}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button variant="ghost" size="sm" onClick={() => setReveal((r) => !r)} aria-pressed={reveal} data-testid="reveal-address">{reveal ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}{reveal ? t("hv.hide") : t("hv.reveal")}</Button>
          <Button variant="ghost" size="sm" onClick={onEdit} data-testid="edit-address"><Pencil aria-hidden="true" />{t("hv.edit")}</Button>
          <Button variant="ghost" size="sm" onClick={() => setDel(true)} data-testid="delete-address"><Trash2 className="text-destructive" aria-hidden="true" />{t("hv.delete")}</Button>
        </div>
      </div>
      {!a.confirmed && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-warning-soft p-3 text-sm"><span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-warning" aria-hidden="true" />{t("hv.unconfirmed")}</span>
          <Button size="sm" disabled={confirm.isPending} onClick={() => confirm.mutate(a.id, { onSuccess: () => toast.success(t("hv.confirmed")), onError: () => toast.error(t("states.errorTitle")) })} data-testid="confirm-address">{t("hv.confirmAddress")}</Button></div>
      )}
      <Dialog open={del} onOpenChange={setDel}>
        <DialogContent><DialogHeader><DialogTitle>{t("hv.deleteTitle")}</DialogTitle><DialogDescription>{t("hv.deleteBody")}</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setDel(false)}>{t("appointment.keep")}</Button>
            <Button variant="destructive" disabled={remove.isPending} data-testid="confirm-delete-address" onClick={() => remove.mutate(a.id, { onSuccess: () => { setDel(false); toast.success(t("hv.deleted")); }, onError: () => toast.error(t("states.errorTitle")) })}>{t("hv.delete")}</Button></DialogFooter></DialogContent>
      </Dialog>
    </li>
  );
}

export default function AddressesPage() {
  const { t } = useTranslation();
  const q = useAddresses();
  const [form, setForm] = useState<{ open: boolean; editing?: Address }>({ open: false });
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/account" className="inline-flex min-h-11 items-center gap-2 text-sm text-ocean underline underline-offset-4"><ArrowLeft className="h-4 w-4 rtl-flip" aria-hidden="true" />{t("nav.account")}</Link>
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl">{t("hv.addressBook")}</h1>
        <Button onClick={() => setForm({ open: true })} data-testid="add-address"><Plus aria-hidden="true" />{t("hv.addAddress")}</Button></div>
      <p className="text-sm text-muted-foreground">{t("hv.addressPrivacy")}</p>
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data!.length === 0 ? (
        <EmptyState icon={<MapPin className="h-10 w-10" aria-hidden="true" />} title={t("hv.noAddressTitle")} hint={t("hv.noAddressHint")} />
      ) : <ul className="space-y-3">{q.data!.map((a) => <Row key={a.id} a={a} onEdit={() => setForm({ open: true, editing: a })} />)}</ul>}
      {form.open && <AddressForm key={form.editing?.id ?? "new"} open onOpenChange={(o) => !o && setForm({ open: false })} editing={form.editing} />}
    </div>
  );
}
