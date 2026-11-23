import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Badge, Card, Chip, Row, T } from "@/components/ui";
import { config } from "@/lib/config";
import { DEV_OTP, DEV_PATIENTS } from "./testUsers";

/** DEV ONLY: one tap sends the chosen synthetic patient's phone to Kiorex Passport as `login_hint`; the dev IdP fills the phone, sends the code and enters the fixed dev OTP. */
export function DevTestUsers({ onPick, busy }: { onPick: (phone: string) => void; busy?: boolean }) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  const title = ar ? "مستخدمو الاختبار (للتطوير فقط)" : "Test users (dev only)";
  const hint = ar ? `للتطوير المحلي فقط: اضغط على مريض تجريبي لتسجيل الدخول عبر باسبورت برمز التطوير الثابت ${DEV_OTP}.` : `Local development only: tap a synthetic patient to sign in through Passport with the fixed dev code ${DEV_OTP}.`;
  return (
    <Card testID="dev-test-users" style={{ gap: 10 }}>
      <Row style={{ justifyContent: "space-between" }}>
        <T variant="small" weight="semibold" accessibilityRole="header">{title}</T>
        <Badge label="DEV" tone="warning" />
      </Row>
      <T variant="caption" muted>{hint}{config.mock ? ` ${t("signIn.mockNote")}` : ""}</T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {DEV_PATIENTS.map((p) => (
          <Chip key={p.phone} testID={`dev-user-${p.phone}`} label={`${p.name} · ${p.phone} · ${ar ? p.note.ar : p.note.en}`} onPress={busy ? undefined : () => onPick(p.phone)} />
        ))}
      </View>
    </Card>
  );
}
