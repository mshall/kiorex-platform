// Services screen model (parity with web ServicesPage). Pure helpers so they are unit-testable.
import type { IconName } from "@/components/Icon";

export interface ServiceCard { id: "telemedicine" | "pharmacy" | "lab" | "safety" | "reminders"; icon: IconName; flag: string; href: string; titleKey: string; bodyKey: string }

export const SERVICE_CARDS: ServiceCard[] = [
  { id: "telemedicine", icon: "video", flag: "kiorex.telemedicine", href: "/telemedicine", titleKey: "services.telemedicine", bodyKey: "services.teleBody" },
  { id: "pharmacy", icon: "pill", flag: "kiorex.pharmacy_orders", href: "/pharmacy", titleKey: "services.pharmacy", bodyKey: "services.pharmacyBody" },
  { id: "lab", icon: "flask", flag: "kiorex.lab_bookings", href: "/lab", titleKey: "services.lab", bodyKey: "services.labBody" },
  { id: "safety", icon: "shield", flag: "kiorex.home_visits", href: "/appointments", titleKey: "services.safety", bodyKey: "services.safetyBody" },
  { id: "reminders", icon: "bell", flag: "kiorex.record_vault", href: "/records/follow-ups", titleKey: "services.reminders", bodyKey: "services.remindersBody" },
];
export const WHATSAPP_FLAG = "kiorex.whatsapp_booking";

/** wa.me link from EXPO_PUBLIC_WHATSAPP_NUMBER (digits only); null when unset or not a plausible number (never a broken link). */
export function whatsappUrl(raw: string | undefined | null): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? `https://wa.me/${digits}` : null;
}
export const whatsappNumber = (): string | undefined => process.env.EXPO_PUBLIC_WHATSAPP_NUMBER;

export type Availability = "available" | "awaiting" | "paused";
export const availability = (f: { enabled: boolean; awaiting?: boolean }): Availability => (f.enabled ? "available" : f.awaiting ? "awaiting" : "paused");
