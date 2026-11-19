import { useMemo, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/errors";
import { useBookLab, useLabSlots, useLabTests } from "@/api/features";
import { FlagScreen, RequireAuth } from "@/components/feature";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Badge, Banner, Button, Card, Checkbox, Chip, Field, Row, Screen, T } from "@/components/ui";
import { useHostedPay } from "@/hooks/useHostedPay";
import { formatDay, formatMoney, formatTime } from "@/lib/format";

function Body() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const router = useRouter();
  const [q, setQ] = useState("");
  const tests = useLabTests(q);
  const book = useBookLab();
  const { pay, busy } = useHostedPay();
  const [sel, setSel] = useState<string[]>([]);
  const [collection, setCollection] = useState<"HOME" | "WALK_IN">("WALK_IN");
  const [slot, setSlot] = useState<string>();
  const [addr, setAddr] = useState({ line1: "", area: "", phone: "" });
  const [msg, setMsg] = useState<string | null>(null);

  const all = tests.data?.items ?? [];
  const chosen = all.filter((x) => sel.includes(x.code));
  const labId = chosen[0]?.labId;
  const visible = labId ? all.filter((x) => x.labId === labId) : all; // one lab per booking
  const homeOk = chosen.length > 0 && chosen.every((x) => x.homeCollection);
  const effective = collection === "HOME" && !homeOk ? "WALK_IN" : collection;
  const slots = useLabSlots(labId, effective, sel);
  const total = chosen.reduce((n, x) => n + x.priceMinor, 0);
  const picked = slots.data?.slots.find((s) => s.startsAt === slot);
  const addrOk = effective === "WALK_IN" || (addr.line1.trim().length > 2 && addr.phone.trim().length > 5);
  const ready = !!labId && !!picked && addrOk;

  const toggle = (code: string) => { setSlot(undefined); setSel((s) => (s.includes(code) ? s.filter((c) => c !== code) : [...s, code])); };
  const submit = async () => {
    if (!labId || !picked) return;
    setMsg(null);
    try {
      const b = await book.mutateAsync({ labId, testCodes: sel, collectionType: effective, slot: { startsAt: picked.startsAt, endsAt: picked.endsAt }, ...(effective === "HOME" ? { address: { line1: addr.line1.trim(), area: addr.area.trim() || undefined, phone: addr.phone.trim() } } : {}) });
      await pay(b.payment?.checkoutUrl);
      router.replace(`/lab/booking/${b.id}`);
    } catch (e) {
      setMsg(e instanceof ApiError && e.isFeatureDisabled ? t("unavailable.body") : e instanceof ApiError && e.code === "SLOT_TAKEN" ? t("lab.slotTaken") : t("lab.bookFailed"));
    }
  };
  const byLab = useMemo(() => visible.reduce<Record<string, string>>((m, x) => ({ ...m, [x.labId]: x.labName }), {}), [visible]);

  return (
    <Screen testID="lab" style={{ gap: 12 }} footer={sel.length ? (
      <View style={{ gap: 8 }}>
        <Row style={{ justifyContent: "space-between" }}><T weight="bold">{t("lab.total")}</T><T testID="lab-total" weight="bold">{formatMoney(total / 100, lang)}</T></Row>
        <Button testID="book-lab" icon="card" disabled={!ready} loading={book.isPending || busy} title={t("lab.payAndBook")} onPress={() => void submit()} />
      </View>) : undefined}>
      <Row style={{ flexWrap: "wrap" }}><Button small variant="secondary" testID="lab-bookings" icon="list" title={t("lab.myBookings")} onPress={() => router.push("/lab/bookings")} /></Row>
      <Field testID="lab-search" label={t("lab.search")} placeholder={t("lab.searchPlaceholder")} value={q} onChangeText={setQ} />
      {labId ? <Banner tone="ink" body={t("lab.oneLab", { lab: byLab[labId] })} /> : null}
      {msg ? <Banner tone="danger" body={msg} testID="lab-message" /> : null}
      {tests.isLoading ? <LoadingState /> : tests.error ? <ErrorState error={tests.error} onRetry={() => void tests.refetch()} /> : !visible.length ? <EmptyState icon="flask" title={t("lab.noTests")} hint={t("lab.noTestsHint")} /> : visible.map((x) => (
        <Card key={`${x.labId}-${x.code}`} testID={`test-${x.code}`} style={{ gap: 6 }}>
          <Checkbox testID={`pick-${x.code}`} checked={sel.includes(x.code)} onChange={() => toggle(x.code)} label={`${x.name} · ${formatMoney(x.priceMinor / 100, lang)}`} />
          <T variant="caption" muted>{x.labName}</T>
          <Row style={{ flexWrap: "wrap" }}>{x.homeCollection ? <Badge tone="ocean" icon="pin" label={t("lab.homeAvailable")} /> : null}{x.sampleType ? <Badge tone="muted" label={x.sampleType} /> : null}</Row>
          {x.preparation ? <T variant="small" muted>{t("lab.preparation")}: {x.preparation}</T> : null}
        </Card>
      ))}
      {sel.length ? (
        <Card style={{ gap: 10 }}>
          <T variant="h2">{t("lab.collection")}</T>
          <Row style={{ flexWrap: "wrap" }}><Chip testID="coll-WALK_IN" label={t("lab.walkIn")} selected={effective === "WALK_IN"} onPress={() => { setSlot(undefined); setCollection("WALK_IN"); }} />
            <Chip testID="coll-HOME" label={t("lab.home")} selected={effective === "HOME"} onPress={() => { if (homeOk) { setSlot(undefined); setCollection("HOME"); } else setMsg(t("lab.homeNotAll")); }} /></Row>
          {effective === "HOME" ? (<>
            <Field testID="lab-addr1" label={t("pharmacy.addr1")} value={addr.line1} onChangeText={(v) => setAddr((a) => ({ ...a, line1: v }))} />
            <Field testID="lab-area" label={t("pharmacy.area")} value={addr.area} onChangeText={(v) => setAddr((a) => ({ ...a, area: v }))} />
            <Field testID="lab-phone" label={t("pharmacy.phone")} keyboardType="phone-pad" value={addr.phone} onChangeText={(v) => setAddr((a) => ({ ...a, phone: v }))} />
          </>) : null}
          <T variant="label">{t("lab.pickSlot")}</T>
          {slots.isLoading ? <LoadingState /> : slots.error ? <ErrorState error={slots.error} onRetry={() => void slots.refetch()} /> : !slots.data?.slots.length ? <T variant="small" muted>{t("lab.noSlots")}</T> : (
            <Row style={{ flexWrap: "wrap" }}>{slots.data.slots.slice(0, 24).map((s) => <Chip key={s.startsAt} testID={`lslot-${s.startsAt}`} label={`${formatDay(s.startsAt, lang)} · ${formatTime(s.startsAt, lang)}`} selected={slot === s.startsAt} onPress={() => setSlot(s.startsAt)} />)}</Row>
          )}
        </Card>
      ) : null}
    </Screen>
  );
}
export default function LabHome() { return <RequireAuth><FlagScreen flag="kiorex.lab_bookings"><Body /></FlagScreen></RequireAuth>; }
