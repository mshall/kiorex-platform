import { View } from "react-native";
import { useTranslation } from "react-i18next";
import type { S } from "@/api/types";
import { Icon, type IconName } from "@/components/Icon";
import { Badge, Card, Row, T } from "@/components/ui";
import { formatDay } from "@/lib/format";
import { useTheme } from "@/theme";

export type VaultKind = S["VaultItemDto"]["kind"];
export const KIND_ICON: Record<VaultKind, IconName> = { VISIT_SUMMARY: "file", PRESCRIPTION: "pill", LAB_RESULT: "flask", UPLOAD: "upload" };

export function RecordCard({ r, onOpen }: { r: S["VaultItemDto"]; onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const title = r.title || r.fileName || t(`records.kind.${r.kind}`);
  return (
    <Card testID={`record-${r.id}`} onPress={onOpen} accessibilityLabel={title} style={{ gap: 6 }}>
      <Row gap={12} style={{ alignItems: "flex-start" }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center" }}><Icon name={KIND_ICON[r.kind]} size={20} color={colors.ink} /></View>
        <View style={{ flex: 1, gap: 2 }}>
          <T weight="semibold">{title}</T>
          <T variant="small" muted>{t(`records.kind.${r.kind}`)} · {formatDay(r.signedAt ?? r.createdAt, i18n.language)}</T>
          <Row style={{ flexWrap: "wrap" }}><Badge tone={r.source === "PATIENT" ? "muted" : "ocean"} label={t(`records.source.${r.source}`)} />{r.hasFile ? <Badge tone="muted" icon="file" label={t("records.hasFile")} /> : null}</Row>
        </View>
        <Icon name="chevron" size={18} color={colors.muted} mirror />
      </Row>
    </Card>
  );
}

