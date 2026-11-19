import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/states";

export default function NotFoundPage() {
  const { t } = useTranslation();
  return <EmptyState title={t("notFound.title")} hint={t("notFound.body")} action={<Link to="/" className={buttonVariants()}>{t("nav.home")}</Link>} />;
}
