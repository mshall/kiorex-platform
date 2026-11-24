import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Button, Card, Checkbox, IconButton, Row, T } from "@/components/ui";
import { Icon, type IconName } from "@/components/Icon";
import { useTheme } from "@/theme";
import { rememberCard, useContinuityCards, useDismissContinuityCard, useSetContinuityConsent, type ContinuityCard } from "./api";

const META: Record<ContinuityCard["kind"], { icon: IconName; k: "rx" | "lab" | "home" }> = {
  RX_TO_PHARMACY: { icon: "pill", k: "rx" }, LAB_ORDER_TO_LAB: { icon: "flask", k: "lab" }, CARE_PLAN_TO_HOME_VISIT: { icon: "calendarPlus", k: "home" },
};
/** The existing screens a card leads to (the patient app routes). */
export const cardHref = (c: ContinuityCard): string => (c.kind === "RX_TO_PHARMACY" ? "/pharmacy" : c.kind === "LAB_ORDER_TO_LAB" ? "/lab" : "/care-plans");

/**
 * GRW-P4-A continuity cards on the home screen: only the patient's own data, in the app, when the destination gate is open; nothing is sent by growth. The wording never names a condition, a drug or a
 * test. The optional "keep my visit and this order connected" choice is off by default (measurement only: no reward, no price change) and can be turned off any time. Renders nothing when the package
 * is OFF, locked, or has no card, so the home screen looks exactly as before. Targets are 44 pt, text wraps at 320 pt, the meaning is in text and icon.
 */
export function ContinuityCards({ enabled = true }: { enabled?: boolean }) {
  const { t } = useTranslation(); const { colors } = useTheme(); const router = useRouter();
  const q = useContinuityCards(enabled); const setConsent = useSetContinuityConsent(); const dismiss = useDismissContinuityCard();
  const [link, setLink] = useState<boolean | null>(null);
  const cards = q.data?.cards ?? [];
  if (!q.data?.enabled || cards.length === 0) return null;
  const connected = link ?? q.data.consent;
  const open = (c: ContinuityCard) => { if (connected !== q.data!.consent) setConsent.mutate(connected); rememberCard(c.id); router.push(cardHref(c) as never); };
  return (
    <View style={{ gap: 10 }} testID="continuity-cards">
      <View style={{ gap: 2 }}><T variant="h2" accessibilityRole="header">{t("continuity.title")}</T><T variant="small" muted>{t("continuity.intro")}</T></View>
      {cards.map((c) => {
        const m = META[c.kind]; if (!m) return null; const title = t(`continuity.${m.k}.title`);
        return (
          <Card key={c.id} testID={`continuity-card-${m.k}`} style={{ gap: 10 }}>
            <Row gap={10} style={{ alignItems: "flex-start" }}>
              <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}><Icon name={m.icon} color={colors.ink} /></View>
              <View style={{ flex: 1, flexShrink: 1, gap: 4 }}><T weight="semibold" accessibilityRole="header">{title}</T><T variant="small" muted>{t(`continuity.${m.k}.body`)}</T></View>
              <IconButton icon="close" label={t("continuity.dismissLabel", { title })} testID={`continuity-dismiss-${m.k}`} onPress={() => dismiss.mutate(c.id)} />
            </Row>
            <Checkbox testID="continuity-consent" checked={connected} onChange={setLink} label={t("continuity.consent.label")} />
            <T variant="caption" muted>{t("continuity.consent.help")}{q.data?.consent ? "" : ` ${t("continuity.consent.draft")}`}</T>
            <Row gap={8} style={{ flexWrap: "wrap" }}>
              <Button testID={`continuity-open-${m.k}`} title={t(`continuity.${m.k}.cta`)} onPress={() => open(c)} />
              <Button variant="ghost" title={t("continuity.dismiss")} onPress={() => dismiss.mutate(c.id)} />
            </Row>
          </Card>
        );
      })}
      <T variant="caption" muted>{t("continuity.privacy")}</T>
    </View>
  );
}
