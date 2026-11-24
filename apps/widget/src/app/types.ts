export interface Boot {
  /** Organisation (clinic) slug of the embed URL. */
  org: string;
  locale: 'ar' | 'en';
  brand: { accent: string; onAccent: string; accentText: string; radius: number; logo: boolean };
  doctor: string | null;
  specialty: string | null;
  /** Origin the SDK says it runs on (`po` query). Verified by the postMessage handshake before it is used. */
  po: string | null;
  sandbox: boolean;
  lt: string | null;
  ref: string | null;
  authority: string;
  clientId: string;
  self: string;
  version: string;
  tz: string;
}

export interface Fee { typeId: string; nameEn: string | null; nameAr: string | null; amountMinor: number; currency: string }
export interface ProviderCard { id: string; nameEn: string | null; nameAr: string | null; specialty: string | null; titleEn: string | null; titleAr: string | null; photoUrl: string | null; rating: { average: number; count: number }; acceptsDeposit: boolean; fees: Fee[] }
export interface WidgetConfig {
  org: { id: string; slug: string; nameEn: string | null; nameAr: string | null; logoUrl: string | null };
  providers: ProviderCard[];
  specialties: { code: string; en: string; ar: string }[];
  patientUrl: string;
  scope: { doctor: string | null; specialty: string | null };
}
export interface Slot { startsAt: string; endsAt: string }
export interface BookingView { id: string; status: string; startsAt: string; holdExpiresAt: string | null; depositStatus: string; deposit: { checkoutUrl: string | null } | null; doctor: { nameEn: string | null; nameAr: string | null } | null }
