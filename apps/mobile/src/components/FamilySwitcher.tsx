import { ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import { usePatient } from "@/hooks/usePatient";
import { Chip } from "./ui";

/** Family switcher: who is this visit for? (self + dependants). */
export function FamilySwitcher() {
  const { t } = useTranslation();
  const { patients, selectedId, setSelectedId } = usePatient();
  if (patients.length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel={t("family.switcher")} contentContainerStyle={{ gap: 8 }} testID="family-switcher">
      {patients.map((p) => <Chip key={p.id} testID={`patient-${p.id}`} icon="user" label={p.relationship === "self" ? t("family.me") : p.name} selected={p.id === selectedId} onPress={() => setSelectedId(p.id)} />)}
    </ScrollView>
  );
}
