import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/Icon";
import { Row, T } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { useTheme } from "@/theme";
import type { SponsoredQuote } from "./api";

/**
 * GRW-P2-S: the sponsored discount line of the checkout. Always "sponsored by <clinic> until <date>", never a Kiorex discount. The meaning is in text plus an icon (not colour alone); the group is one
 * accessible element reading label, amount and note together; the amount is a left-to-right island inside right-to-left Arabic; text wraps at 320 px (no fixed widths).
 */
export function SponsoredDiscountLine({ quote }: { quote: SponsoredQuote }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const lang = i18n.language; const ar = lang.startsWith("ar");
  const sponsor = (ar ? quote.sponsor.ar : quote.sponsor.en) || t("sponsored.title");
  const label = (ar ? quote.label.ar : quote.label.en) || t("sponsored.line", { sponsor, date: quote.endsAt.slice(0, 10) });
  const amount = formatMoney(quote.amountMinor / 100, lang);
  return (
    <View testID="sponsored-line" accessible accessibilityRole="summary" accessibilityLabel={`${label}. ${t("sponsored.amount", { amount })}. ${t("sponsored.note", { sponsor })}`}
      style={{ gap: 4, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.success, backgroundColor: colors.successSoft }}>
      <Row gap={8} style={{ alignItems: "flex-start" }}>
        <Icon name="check" size={16} color={colors.success} />
        <T variant="small" weight="bold" style={{ flex: 1, flexShrink: 1 }} testID="sponsored-label">{label}</T>
        <T variant="small" weight="bold" forceLatin testID="sponsored-amount" style={{ writingDirection: "ltr" }}>{`−${amount}`}</T>
      </Row>
      <T variant="caption" muted testID="sponsored-note">{t("sponsored.note", { sponsor })}</T>
    </View>
  );
}
