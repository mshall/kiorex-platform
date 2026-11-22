import { useState } from "react";
import { Linking, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useReportProblem, useSafetyCard } from "@/api/homecare";
import { RequireAuth } from "@/components/feature";
import { Avatar } from "@/components/bits";
import { ErrorState, LoadingState } from "@/components/states";
import { Badge, Banner, Button, Card, Chip, Field, Row, Screen, Sheet, T } from "@/components/ui";
import { badgeText, PROBLEM_CATEGORIES, type ProblemCategory } from "@/lib/homecare";
import { formatDay, formatTime } from "@/lib/format";
import { telUrl } from "@/lib/calendar";
import { useTheme } from "@/theme";

type Card_ = { provider?: { displayName?: string | null; displayNameAr?: string | null; photoUrl?: string | null; badge?: { en: string; ar: string } | string | null; profession?: string | null; verified?: boolean; register?: string | null; agency?: boolean }; reportProblem?: { slaMinutes?: number }; familyShare?: { max?: number; active?: number } };

function Body() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const router = useRouter();
  const { colors } = useTheme();
  const q = useSafetyCard(id);
  const report = useReportProblem(id);
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<ProblemCategory>("SAFETY");
  const [body, setBody] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  if (q.isLoading) return <LoadingState />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const c = q.data;
  const x = c as unknown as Card_;
  const p = x.provider ?? {};
  const name = (lang.startsWith("ar") ? p.displayNameAr ?? p.displayName : p.displayName ?? p.displayNameAr) ?? "";
  const sla = x.reportProblem?.slaMinutes ?? 60;
  const submit = () => {
    setErr(false);
    report.mutate({ category: cat, body: body.trim() || undefined }, {
      onSuccess: (r) => { setOpen(false); setBody(""); setDone(t("safety.reported", { time: `${formatDay(r.slaDueAt, lang)} ${formatTime(r.slaDueAt, lang)}` })); },
      onError: () => setErr(true),
    });
  };
  return (
    <>
      <Screen testID="safety-card" style={{ gap: 14 }}>
        <Card testID="safety-provider" style={{ gap: 10 }}>
          <T variant="caption" muted>{t("safety.arriving")}</T>
          {c.assignmentPending && !name ? <Banner tone="ink" testID="safety-pending" body={t("hv.assignmentPending")} /> : (
            <Row gap={14}>
              <Avatar name={name || "K"} size={64} />
              <View style={{ flex: 1, gap: 4 }}>
                <T variant="title" accessibilityRole="header">{name || "—"}</T>
                <Row style={{ flexWrap: "wrap" }}>
                  {badgeText(p.badge, lang) ? <Badge tone="success" icon="shield" label={badgeText(p.badge, lang)} /> : p.verified ? <Badge tone="success" icon="shield" label={t("doctor.verified")} /> : null}
                  {p.agency ? <Badge tone="ocean" label={t("safety.agency")} /> : null}
                </Row>
                {p.register ? <T variant="small" muted>{t("safety.register")}: {p.register}</T> : null}
              </View>
            </Row>
          )}
          {c.assignmentPending && name ? <T variant="small" muted>{t("hv.assignmentPending")}</T> : null}
          <T variant="caption" muted>{t("safety.checkBadge")}</T>
        </Card>

        <Card testID="emergency-card" style={{ gap: 8, borderColor: colors.danger }}>
          <Row gap={8}><T variant="h2" style={{ flex: 1 }}>{t("safety.emergencyTitle")}</T></Row>
          <T variant="small">{t("safety.emergencyBody")}</T>
          <Button testID="call-emergency" variant="danger" icon="phone" title={t("safety.callEmergency", { number: c.emergencyNumber })} onPress={() => void Linking.openURL(telUrl(c.emergencyNumber))} />
        </Card>

        <Card style={{ gap: 8 }}>
          <T variant="h2">{t("safety.reportTitle")}</T>
          <T variant="small" muted>{t("safety.reportBody", { minutes: sla })}</T>
          {done ? <Banner tone="success" body={done} testID="report-done" /> : null}
          <Button testID="report-problem" variant="secondary" icon="alert" title={t("safety.report")} onPress={() => { setDone(null); setOpen(true); }} />
        </Card>

        <Card style={{ gap: 8 }}>
          <T variant="h2">{t("share.title")}</T>
          <T variant="small" muted>{t("share.summary", { active: x.familyShare?.active ?? 0, max: x.familyShare?.max ?? 3 })}</T>
          <Button testID="safety-open-share" variant="secondary" icon="users" title={t("share.open")} onPress={() => router.push(`/family-share/${id}`)} />
        </Card>
      </Screen>
      <Sheet visible={open} onClose={() => setOpen(false)} title={t("safety.report")} testID="report-sheet" footer={<Button testID="submit-report" loading={report.isPending} title={t("safety.submitReport")} onPress={submit} />}>
        <T variant="label">{t("safety.category")}</T>
        <Row style={{ flexWrap: "wrap" }}>{PROBLEM_CATEGORIES.map((k) => <Chip key={k} testID={`problem-${k}`} label={t(`safety.cat.${k}`)} selected={cat === k} onPress={() => setCat(k)} />)}</Row>
        <Field testID="problem-body" label={t("safety.details")} value={body} onChangeText={setBody} multiline maxLength={1000} style={{ minHeight: 100, paddingTop: 12, textAlignVertical: "top" }} />
        <T variant="caption" muted>{t("safety.reportBody", { minutes: sla })}</T>
        {err ? <Banner tone="danger" body={t("safety.reportFailed")} testID="report-error" /> : null}
      </Sheet>
    </>
  );
}
export default function Safety() { return <RequireAuth><Body /></RequireAuth>; }
