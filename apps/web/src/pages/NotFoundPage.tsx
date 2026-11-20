import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { StateArt } from "@/components/kit";
import { cn } from "@/lib/utils";

export default function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="kx-hero relative mx-auto flex max-w-2xl flex-col items-center gap-4 overflow-hidden rounded-3xl border px-6 py-14 text-center shadow-card" data-testid="empty-state">
      <StateArt kind="search" className="h-36 w-36" />
      <p className="kx-eyebrow kx-label-num" dir="ltr">{t("p3.notFoundCode")}</p>
      <h1 className="text-3xl md:text-4xl">{t("notFound.title")}</h1>
      <p className="max-w-md text-muted-foreground">{t("notFound.body")}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <Link to="/" className={buttonVariants({ size: "lg" })}>{t("p3.goHome")}</Link>
        <Link to="/search" className={cn(buttonVariants({ size: "lg", variant: "outline" }))}><Search aria-hidden="true" />{t("nav.search")}</Link>
      </div>
    </div>
  );
}
