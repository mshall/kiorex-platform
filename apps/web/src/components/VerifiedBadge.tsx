import { BadgeCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";

export function VerifiedBadge() {
  const { t } = useTranslation();
  return (
    <Badge variant="info" className="gap-1" data-testid="verified-badge">
      <BadgeCheck className="h-4 w-4" aria-hidden="true" />{t("doctor.verified")}
    </Badge>
  );
}
