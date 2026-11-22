import { useTranslation } from "react-i18next";
import { ServiceCards, WhatsAppCard } from "@/components/ServiceCards";
import { Screen, T } from "@/components/ui";
import { whatsappNumber } from "@/lib/services";

/** Parity with web ServicesPage: Telemedicine, Pharmacy, Lab, Safety, Reminders (availability from the feature-flag API) plus WhatsApp booking. */
export default function ServicesScreen() {
  const { t } = useTranslation();
  return (
    <Screen testID="services" style={{ gap: 12 }}>
      <T muted>{t("services.intro")}</T>
      <ServiceCards />
      <WhatsAppCard number={whatsappNumber()} />
    </Screen>
  );
}
