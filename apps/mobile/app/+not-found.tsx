import { Link } from "expo-router";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/states";
import { Screen, T } from "@/components/ui";

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <Screen><EmptyState icon="search" title={t("notFound.title")} hint={t("notFound.body")} action={<Link href="/(tabs)"><T color="#3730A3" weight="semibold">{t("nav.home")}</T></Link>} /></Screen>
  );
}
