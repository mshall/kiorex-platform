import { useTranslation } from "react-i18next";
import { SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/kit";
import { PreferenceCentre } from "@/components/consent";

/** `/preferences` and `/:locale/:cc/preferences`: the patient preference centre (noindex: the shell sets robots for every non-public route). */
export default function PreferencesPage() {
  const { t } = useTranslation();
  return (
    <div className="container max-w-3xl py-8">
      <meta name="robots" content="noindex" />
      <PageHeader title={t("consent.centre.title")} hint={t("consent.centre.hint")} icon={<SlidersHorizontal />} />
      <PreferenceCentre />
    </div>
  );
}
