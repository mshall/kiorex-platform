import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/errors";
import { useAddFamily, useFamily, useRemoveFamily } from "@/api/hooks";
import { EmptyState, ErrorState, LoadingState, UnavailableState } from "@/components/states";
import { Banner, Button, Card, Chip, Field, Row, Screen, Sheet, T } from "@/components/ui";
import { useFeature } from "@/hooks/useFeature";
import { pick } from "@/lib/format";
import { RequireAuth } from "@/components/feature";

const RELS = ["CHILD", "PARENT", "SPOUSE", "OTHER"] as const;

function FamilyBody() {
  const { t, i18n } = useTranslation();
  const family = useFamily();
  const add = useAddFamily();
  const remove = useRemoveFamily();
  const flag = useFeature("kiorex.family_accounts");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [rel, setRel] = useState<(typeof RELS)[number]>("CHILD");
  const [msg, setMsg] = useState<string | null>(null);
  const valid = name.trim().length > 1 && /^\d{4}-\d{2}-\d{2}$/.test(dob);

  const save = () => add.mutate({ nameEn: name.trim(), dateOfBirth: dob, relationship: rel }, {
    onSuccess: () => { setOpen(false); setName(""); setDob(""); setMsg(t("family.added")); },
    onError: (e) => setMsg(e instanceof ApiError && e.isFeatureDisabled ? t("unavailable.title") : t("family.addFailed")),
  });
  return (
    <>
      <Screen testID="family" style={{ gap: 12 }}>
        {msg ? <Banner tone="ink" body={msg} /> : null}
        {family.isLoading ? <LoadingState /> : family.error ? <ErrorState error={family.error} onRetry={() => void family.refetch()} /> : !family.data?.length ? <EmptyState icon="users" title={t("family.empty")} hint={t("family.emptyHint")} /> : family.data.map((m) => (
          <Card key={m.id} style={{ gap: 8 }}>
            <Row style={{ justifyContent: "space-between" }}><View><T weight="semibold">{pick(m, "name", i18n.language)}</T><T variant="small" muted>{t(`family.rel.${m.relationship}`, { defaultValue: m.relationship })}{m.dateOfBirth ? ` · ${m.dateOfBirth.slice(0, 10)}` : ""}</T></View>
              <Button small variant="ghost" title={t("common.close") && t("family.remove", { name: pick(m, "name", i18n.language) })} onPress={() => remove.mutate(m.id)} /></Row>
          </Card>
        ))}
        {flag.enabled ? <Button testID="add-family" title={t("family.add")} icon="users" onPress={() => setOpen(true)} /> : <UnavailableState featureKey="kiorex.family_accounts" />}
      </Screen>
      <Sheet visible={open} onClose={() => setOpen(false)} title={t("family.add")} footer={<Button testID="save-family" disabled={!valid} loading={add.isPending} title={t("common.save")} onPress={save} />}>
        <Field testID="family-name" label={t("family.name")} value={name} onChangeText={setName} />
        <Field testID="family-dob" label={`${t("family.dob")} (YYYY-MM-DD)`} value={dob} onChangeText={setDob} keyboardType="numbers-and-punctuation" placeholder="2018-04-02" style={{ writingDirection: "ltr" }} />
        <T variant="label">{t("family.relationship")}</T>
        <Row style={{ flexWrap: "wrap" }}>{RELS.map((r) => <Chip key={r} label={t(`family.rel.${r.toLowerCase()}`)} selected={rel === r} onPress={() => setRel(r)} />)}</Row>
      </Sheet>
    </>
  );
}

export default function Family() { return <RequireAuth><FamilyBody /></RequireAuth>; }
