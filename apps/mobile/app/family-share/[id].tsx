import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useCreateFamilyShare, useFamilyShares, useRevokeFamilyShare } from "@/api/homecare";
import { useConsents } from "@/api/hooks";
import { RequireAuth } from "@/components/feature";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Badge, Banner, Button, Card, Checkbox, Chip, Field, Row, Screen, T } from "@/components/ui";
import { classifyHomeError, MAX_FAMILY_SHARES, validInternationalPhone } from "@/lib/homecare";

function Body() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const list = useFamilyShares(id);
  const consents = useConsents();
  const create = useCreateFamilyShare(id);
  const revoke = useRevokeFamilyShare(id);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [locale, setLocale] = useState<"ar" | "en">(i18n.language.startsWith("en") ? "en" : "ar");
  const [attested, setAttested] = useState(false);
  const [consent, setConsent] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const hasConsent = !!consents.data?.find((c) => c.purpose === "VISIT_STATUS_SHARING")?.granted;
  const active = (list.data ?? []).filter((s) => s.status === "ACTIVE");
  const full = active.length >= MAX_FAMILY_SHARES;
  const valid = name.trim().length > 1 && validInternationalPhone(phone) && attested && (hasConsent || consent) && !full;

  const submit = () => {
    setMsg(null); setLink(null);
    create.mutate({ contactName: name.trim(), phone: phone.trim(), locale, consentAttested: attested, visitStatusSharingConsent: consent || undefined }, {
      onSuccess: (r) => { setName(""); setPhone(""); setAttested(false); setLink(r.link); setMsg({ tone: "success", text: t("share.sent") }); },
      onError: (e) => {
        const k = classifyHomeError(e).kind;
        const key = { share_limit: "share.limit", contact_exists: "share.exists", invalid_phone: "share.invalidPhone", consent_required: "share.consentRequired", contact_consent: "share.attestRequired", not_shareable: "share.notShareable", feature_disabled: "unavailable.body" }[k as string] ?? "share.failed";
        setMsg({ tone: "danger", text: t(key) });
      },
    });
  };
  return (
    <Screen testID="family-share" style={{ gap: 12 }}>
      <Banner tone="ink" title={t("share.whatTitle")} body={t("share.whatBody")} />
      {msg ? <Banner tone={msg.tone} body={msg.text} testID="share-message">{link ? <T variant="caption" testID="share-link" selectable style={{ writingDirection: "ltr" }}>{link}</T> : null}</Banner> : null}
      {list.isLoading ? <LoadingState /> : list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : !list.data?.length ? (
        <EmptyState icon="users" title={t("share.empty")} hint={t("share.emptyHint")} />
      ) : list.data.map((s) => (
        <Card key={s.id} testID={`share-${s.id}`} style={{ gap: 6 }}>
          <Row style={{ justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}><T weight="semibold">{s.contactName}</T><T variant="small" muted style={{ writingDirection: "ltr", textAlign: i18n.language.startsWith("ar") ? "right" : "left" }}>{s.phoneMasked}</T></View>
            <Badge tone={s.status === "ACTIVE" ? "success" : "muted"} label={t(`share.status.${s.status}`)} />
          </Row>
          {s.status === "ACTIVE" ? <Button testID={`revoke-${s.id}`} small variant="ghost" icon="close" loading={revoke.isPending && revoke.variables === s.id} title={t("share.stop")} onPress={() => revoke.mutate(s.id)} /> : null}
        </Card>
      ))}
      <Card style={{ gap: 10 }} testID="share-form">
        <T variant="h2">{t("share.addTitle", { count: active.length, max: MAX_FAMILY_SHARES })}</T>
        {full ? <Banner tone="warning" body={t("share.limit")} testID="share-full" /> : null}
        <Field testID="share-name" label={t("share.contactName")} value={name} onChangeText={setName} maxLength={80} />
        <Field testID="share-phone" label={t("share.contactPhone")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+20…" maxLength={20} style={{ writingDirection: "ltr" }} />
        <T variant="label">{t("share.language")}</T>
        <Row>{(["ar", "en"] as const).map((l) => <Chip key={l} testID={`share-locale-${l}`} label={t(`settings.${l}`)} selected={locale === l} onPress={() => setLocale(l)} />)}</Row>
        <Checkbox testID="share-attest" checked={attested} onChange={setAttested} label={t("share.attest")} />
        {hasConsent ? <T variant="caption" muted>{t("share.consentGranted")}</T> : <Checkbox testID="share-consent" checked={consent} onChange={setConsent} label={t("share.consent")} />}
        <T variant="caption" muted>{t("share.whatsappMock")}</T>
        <Button testID="send-share" icon="users" disabled={!valid} loading={create.isPending} title={t("share.send")} onPress={submit} />
      </Card>
    </Screen>
  );
}
export default function FamilyShare() { return <RequireAuth><Body /></RequireAuth>; }
