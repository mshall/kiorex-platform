/**
 * TRIMMED demo dataset for DEPLOYED non-production environments (kx-test, kx-staging, ...), pure data and pure checks (no database, no network).
 *
 * Why a second demo seed: the full DEV demo seed (prisma/demo/seed-demo.ts) needs demo providers synced from a Kiorly Clinic and records public dev gate
 * evidence (DEV-ONLY-NOT-A-REAL-GATE) and dev product keys. A deployed environment has neither a demo Clinic nor any reason to carry dev gates or dev secrets.
 * This seed writes the providers directly, with the same row shape the Clinic sync would create (every provider goes through `mapProviderDto`), and writes
 * NO gate evidence, NO product keys and NO secrets of any kind.
 *
 * Ids: every row id starts with a prefix that the demo marker registers (DEMO_TARGETS in ./demo-data.ts), so `npm run demo-data:remove` can take them out later.
 * Names carry the word "Demo" so a person can tell at a glance, and no real person, phone number or e-mail appears anywhere (phones are the +2010000xxxxx demo range).
 */
import { checkDemoSeedAllowed, DemoSeedRefusedError, type SeedEnv } from './demo-seed-guard';

/** Deployment environments this seed may run in. `local` and `dev` use the full DEV demo seed instead (it needs a local Clinic and dev keys). */
export const DEPLOYED_SEED_ENVS = ['test', 'testing', 'staging', 'stage', 'qa', 'demo', 'sandbox', 'preview'] as const;

/** Throws DemoSeedRefusedError unless this is a declared, deployed, non-production environment. Returns the environment name. Never prints secrets. */
export function checkDeployedSeedAllowed(env: SeedEnv = process.env): string {
  const base = checkDemoSeedAllowed(env); // DEMO_SEED_ALLOWED=true, never production, never a production-looking database
  const declared = (env.KIOREX_ENV ?? env.KIORLY_ENV ?? env.ENV_TAG ?? '').trim().toLowerCase();
  if (!declared) throw new DemoSeedRefusedError('the deployed seed needs KIOREX_ENV (or KIORLY_ENV / ENV_TAG) to name the environment (for example test)');
  if (!(DEPLOYED_SEED_ENVS as readonly string[]).includes(declared)) {
    throw new DemoSeedRefusedError(`the deployed seed runs only in ${DEPLOYED_SEED_ENVS.join(', ')} (got "${declared}"); local development uses db:seed:demo, which needs a local Clinic and dev keys`);
  }
  if (env.SEED_DEV_GATES === 'true') throw new DemoSeedRefusedError('SEED_DEV_GATES=true asks for dev gate evidence; this seed never records any');
  return base === 'local' ? declared : base;
}

// ───────────────────────── id prefixes (all registered in DEMO_TARGETS) ─────────────────────────
export const IDS = {
  provider: 'demo_dp_', tenant: 'demo_dt_', clinic: 'demo_dc_', clinician: 'demo_dk_', type: 'demo_dty_',
  booking: 'demo_bk_dx', payment: 'demo_pay_dx', refund: 'demo_rf_dx', payout: 'demo_po_dx', ledgerKey: 'demo:dx:', event: 'demo_bk_dx',
  review: 'demo_rv_dx', charge: 'demo_chg_', appointment: 'demo_dx_apt_', run: 'crn_demo_', attempt: 'cat_demo_', pharmacyOrder: 'kx_ph_demo_dx', labBooking: 'kx_lb_demo_dx',
  message: 'demo_msg_dx', messageLog: 'demo_ml_dx', waitlist: 'demo_wl_dx',
} as const;

/** Demo patients are the same 13 personas the Passport demo seed creates (subs 01HZKXD...1001-1013, phones +2010000100x), so a Passport sign-in lands on a patient that has data. */
export const patientSub = (n: number): string => `01HZKXD${String(n).padStart(19, '0')}`;
export const patientPhone = (n: number): string => `+20100000${String(n).padStart(4, '0')}`;
export const PATIENTS: { n: number; en: string; ar: string; g: 'F' | 'M'; dob: string; loc: 'ar' | 'en' }[] = [
  { n: 1001, en: 'Hoda Mahmoud', ar: 'هدى محمود', g: 'F', dob: '1989-03-14', loc: 'ar' }, { n: 1002, en: 'Samir Ali Nassar', ar: 'سمير علي نصار', g: 'M', dob: '1986-07-02', loc: 'ar' },
  { n: 1003, en: 'Karim Mostafa', ar: 'كريم مصطفى', g: 'M', dob: '1984-11-21', loc: 'en' }, { n: 1004, en: 'Nourhan Fathy', ar: 'نورهان فتحي', g: 'F', dob: '1995-01-30', loc: 'ar' },
  { n: 1005, en: 'Mahmoud El-Sayed', ar: 'محمود السيد', g: 'M', dob: '1972-05-09', loc: 'ar' }, { n: 1006, en: 'Mariam Adel', ar: 'مريم عادل', g: 'F', dob: '1993-09-17', loc: 'en' },
  { n: 1007, en: 'Omar Hegazy', ar: 'عمر حجازي', g: 'M', dob: '1997-12-03', loc: 'en' }, { n: 1008, en: 'Dalia Ibrahim', ar: 'داليا إبراهيم', g: 'F', dob: '1988-04-25', loc: 'ar' },
  { n: 1009, en: 'Tarek Zaki', ar: 'طارق زكي', g: 'M', dob: '1990-08-11', loc: 'en' }, { n: 1010, en: 'Heba Salah', ar: 'هبة صلاح', g: 'F', dob: '1991-02-19', loc: 'ar' },
  { n: 1011, en: 'Youssef Ramadan', ar: 'يوسف رمضان', g: 'M', dob: '2000-06-06', loc: 'en' }, { n: 1012, en: 'Rana Khaled', ar: 'رنا خالد', g: 'F', dob: '1985-10-28', loc: 'ar' },
];

// ───────────────────────── providers (clinics) ─────────────────────────
export interface DemoOrg { n: number; nameEn: string; nameAr: string; governorate: string; area: string; lat: number; lng: number; addressEn: string; addressAr: string }
export const ORGS: DemoOrg[] = [
  { n: 1, nameEn: 'Demo Nile Family Clinic', nameAr: 'عيادة النيل التجريبية', governorate: 'Cairo', area: 'Maadi', lat: 29.9602, lng: 31.2569, addressEn: '1 Demo Street, Maadi', addressAr: 'شارع التجربة ١، المعادي' },
  { n: 2, nameEn: 'Demo Zamalek Skin and Dental', nameAr: 'عيادة الزمالك التجريبية للجلد والأسنان', governorate: 'Cairo', area: 'Zamalek', lat: 30.0626, lng: 31.2197, addressEn: '2 Demo Street, Zamalek', addressAr: 'شارع التجربة ٢، الزمالك' },
  { n: 3, nameEn: 'Demo Heliopolis Heart and Bone', nameAr: 'عيادة مصر الجديدة التجريبية للقلب والعظام', governorate: 'Cairo', area: 'Heliopolis', lat: 30.0911, lng: 31.3225, addressEn: '3 Demo Street, Heliopolis', addressAr: 'شارع التجربة ٣، مصر الجديدة' },
  { n: 4, nameEn: "Demo Alexandria Women's Care", nameAr: 'عيادة الإسكندرية التجريبية لصحة المرأة', governorate: 'Alexandria', area: 'Smouha', lat: 31.2156, lng: 29.9553, addressEn: '4 Demo Street, Smouha', addressAr: 'شارع التجربة ٤، سموحة' },
];

export interface DemoProviderSpec { n: number; org: number; nameEn: string; nameAr: string; specialty: string; gender: 'FEMALE' | 'MALE'; feeMajor: number; depositMajor?: number; languages: string[] }
export const PROVIDERS: DemoProviderSpec[] = [
  { n: 1, org: 1, nameEn: 'Dr Demo Hana Saleh', nameAr: 'د. هنا صالح (تجريبي)', specialty: 'paediatrics', gender: 'FEMALE', feeMajor: 450, depositMajor: 150, languages: ['ar', 'en'] },
  { n: 2, org: 1, nameEn: 'Dr Demo Karim Aziz', nameAr: 'د. كريم عزيز (تجريبي)', specialty: 'internal_medicine', gender: 'MALE', feeMajor: 400, languages: ['ar', 'en'] },
  { n: 3, org: 2, nameEn: 'Dr Demo Laila Farouk', nameAr: 'د. ليلى فاروق (تجريبي)', specialty: 'dermatology', gender: 'FEMALE', feeMajor: 600, depositMajor: 150, languages: ['ar', 'en'] },
  { n: 4, org: 2, nameEn: 'Dr Demo Tarek Mansour', nameAr: 'د. طارق منصور (تجريبي)', specialty: 'dentistry', gender: 'MALE', feeMajor: 500, languages: ['ar'] },
  { n: 5, org: 3, nameEn: 'Dr Demo Samy Wahba', nameAr: 'د. سامي وهبة (تجريبي)', specialty: 'cardiology', gender: 'MALE', feeMajor: 800, depositMajor: 200, languages: ['ar', 'en'] },
  { n: 6, org: 3, nameEn: 'Dr Demo Nadine Fares', nameAr: 'د. نادين فارس (تجريبي)', specialty: 'orthopaedics', gender: 'FEMALE', feeMajor: 700, languages: ['ar', 'en'] },
  { n: 7, org: 4, nameEn: 'Dr Demo Mervat Ghoneim', nameAr: 'د. ميرفت غنيم (تجريبي)', specialty: 'obgyn', gender: 'FEMALE', feeMajor: 650, depositMajor: 150, languages: ['ar', 'en'] },
  { n: 8, org: 4, nameEn: 'Dr Demo Adel Kamel', nameAr: 'د. عادل كامل (تجريبي)', specialty: 'ent', gender: 'MALE', feeMajor: 450, languages: ['ar'] },
];

export const providerId = (n: number) => `${IDS.provider}${n}`;
export const tenantId = (org: number) => `${IDS.tenant}${org}`;
export const clinicId = (org: number) => `${IDS.clinic}${org}`;
export const clinicianId = (n: number) => `${IDS.clinician}${n}`;
export const typeId = (n: number) => `${IDS.type}${n}`;

/** The Kiorly PublishedProviderDto the Clinic sync would deliver for each demo provider (fed to `mapProviderDto`, so the Provider row is exactly what a sync creates). */
export function providerDtos(updatedAt: string): any[] {
  return PROVIDERS.map((p) => {
    const o = ORGS.find((x) => x.n === p.org)!;
    return {
      listingId: providerId(p.n), tenantId: tenantId(o.n), clinicId: clinicId(o.n), clinicianId: clinicianId(p.n), status: 'LIVE', completenessPercent: 100, updatedAt,
      profession: p.specialty === 'dentistry' ? 'DENTIST' : 'PHYSICIAN', edition: 'CLINIC', serviceLocations: ['IN_CLINIC'],
      provider: {
        displayNameEn: p.nameEn, displayNameAr: p.nameAr, specialty: p.specialty, languages: p.languages, gender: p.gender, governorate: o.governorate, area: o.area,
        fees: [{ appointmentTypeId: typeId(p.n), nameEn: 'Consultation', nameAr: 'كشف', amount: p.feeMajor, currency: 'EGP', ...(p.depositMajor ? { depositRequired: true, depositAmount: p.depositMajor } : {}) }],
        acceptsDeposit: Boolean(p.depositMajor),
      },
      clinic: { nameEn: o.nameEn, nameAr: o.nameAr, addressEn: o.addressEn, addressAr: o.addressAr, governorate: o.governorate, area: o.area, latitude: o.lat, longitude: o.lng, logoUrl: null },
    };
  });
}

// ───────────────────────── bookings ─────────────────────────
export type DepositKind = 'NONE' | 'REQUIRED' | 'PAID' | 'RELEASED' | 'FORFEITED' | 'REFUNDED';
export interface DemoBookingSpec { key: string; provider: number; patient: number; status: string; dayOffset: number; hourUtc: number; deposit: DepositKind; review?: { rating: number; text: string } }
/** 15 bookings in every state the console and the patient web show. Day offsets are relative to today (negative = past). */
export const BOOKINGS: DemoBookingSpec[] = [
  { key: '01', provider: 1, patient: 1001, status: 'COMPLETED', dayOffset: -12, hourUtc: 9, deposit: 'RELEASED', review: { rating: 5, text: 'Excellent with my child, clean clinic (demo review).' } },
  { key: '02', provider: 1, patient: 1002, status: 'COMPLETED', dayOffset: -9, hourUtc: 10, deposit: 'NONE', review: { rating: 4, text: 'Good consultation, short wait (demo review).' } },
  { key: '03', provider: 3, patient: 1003, status: 'COMPLETED', dayOffset: -8, hourUtc: 11, deposit: 'RELEASED', review: { rating: 5, text: 'Clear plan and follow-up (demo review).' } },
  { key: '04', provider: 5, patient: 1005, status: 'COMPLETED', dayOffset: -6, hourUtc: 8, deposit: 'RELEASED' },
  { key: '05', provider: 7, patient: 1006, status: 'COMPLETED', dayOffset: -5, hourUtc: 12, deposit: 'NONE', review: { rating: 3, text: 'Long waiting time (demo review).' } },
  { key: '06', provider: 6, patient: 1007, status: 'COMPLETED', dayOffset: -3, hourUtc: 9, deposit: 'NONE' },
  { key: '07', provider: 2, patient: 1004, status: 'CONFIRMED', dayOffset: 1, hourUtc: 9, deposit: 'NONE' },
  { key: '08', provider: 3, patient: 1008, status: 'CONFIRMED', dayOffset: 2, hourUtc: 10, deposit: 'PAID' },
  { key: '09', provider: 5, patient: 1009, status: 'CONFIRMED', dayOffset: 3, hourUtc: 11, deposit: 'PAID' },
  { key: '10', provider: 4, patient: 1010, status: 'CONFIRMED', dayOffset: 4, hourUtc: 8, deposit: 'NONE' },
  { key: '11', provider: 7, patient: 1011, status: 'PENDING_CLINIC', dayOffset: 5, hourUtc: 9, deposit: 'PAID' },
  { key: '12', provider: 1, patient: 1012, status: 'CANCELLED', dayOffset: -2, hourUtc: 10, deposit: 'REFUNDED' },
  { key: '13', provider: 8, patient: 1001, status: 'CANCELLED', dayOffset: 6, hourUtc: 13, deposit: 'NONE' },
  { key: '14', provider: 3, patient: 1004, status: 'NO_SHOW', dayOffset: -4, hourUtc: 14, deposit: 'FORFEITED' },
  { key: '15', provider: 2, patient: 1003, status: 'CONFIRMED', dayOffset: 7, hourUtc: 15, deposit: 'NONE' },
];

// ───────────────────────── commission claims (the Clinic's COMMISSION_CHARGE_* events, applied through the real claim service) ─────────────────────────
export interface DemoClaimSpec {
  key: string; org: number; provider: number; amountMajor: number; feeBasisMinor: number; tender: 'ONLINE' | 'CASH' | null; tenderMethod?: 'CASH' | 'CASH_TRANSFER'; tenderDetail?: 'BANK_TRANSFER' | 'INSTAPAY' | 'CARD_TERMINAL';
  /** Final charge status after the event sequence. */
  status: 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'REVERSED' | 'WAIVED'; attendedDaysAgo: number;
  /** Collection state set directly by the seed for the two demo runs (see RUNS). */
  run?: 'INVOICE' | 'DEDUCTED';
}
export const CLAIMS: DemoClaimSpec[] = [
  { key: '01', org: 1, provider: 1, amountMajor: 13.5, feeBasisMinor: 45000, tender: 'ONLINE', status: 'CONFIRMED', attendedDaysAgo: 40, run: 'DEDUCTED' },
  { key: '02', org: 1, provider: 2, amountMajor: 12, feeBasisMinor: 40000, tender: 'CASH', tenderMethod: 'CASH', status: 'CONFIRMED', attendedDaysAgo: 38, run: 'INVOICE' },
  { key: '03', org: 1, provider: 1, amountMajor: 13.5, feeBasisMinor: 45000, tender: 'CASH', tenderMethod: 'CASH_TRANSFER', tenderDetail: 'INSTAPAY', status: 'CONFIRMED', attendedDaysAgo: 35, run: 'INVOICE' },
  { key: '04', org: 1, provider: 2, amountMajor: 12, feeBasisMinor: 40000, tender: 'CASH', tenderMethod: 'CASH_TRANSFER', tenderDetail: 'BANK_TRANSFER', status: 'CONFIRMED', attendedDaysAgo: 33, run: 'INVOICE' },
  { key: '05', org: 2, provider: 3, amountMajor: 18, feeBasisMinor: 60000, tender: 'ONLINE', status: 'CONFIRMED', attendedDaysAgo: 37, run: 'DEDUCTED' },
  { key: '06', org: 2, provider: 4, amountMajor: 15, feeBasisMinor: 50000, tender: 'CASH', tenderMethod: 'CASH_TRANSFER', tenderDetail: 'CARD_TERMINAL', status: 'CONFIRMED', attendedDaysAgo: 8 },
  { key: '07', org: 2, provider: 3, amountMajor: 18, feeBasisMinor: 60000, tender: 'ONLINE', status: 'CONFIRMED', attendedDaysAgo: 8 },
  { key: '08', org: 3, provider: 5, amountMajor: 24, feeBasisMinor: 80000, tender: 'CASH', tenderMethod: 'CASH', status: 'PENDING', attendedDaysAgo: 3 },
  { key: '09', org: 3, provider: 6, amountMajor: 21, feeBasisMinor: 70000, tender: 'ONLINE', status: 'DISPUTED', attendedDaysAgo: 6 },
  { key: '10', org: 3, provider: 5, amountMajor: 24, feeBasisMinor: 80000, tender: 'CASH', status: 'REVERSED', attendedDaysAgo: 20 },
  { key: '11', org: 4, provider: 7, amountMajor: 19.5, feeBasisMinor: 65000, tender: 'ONLINE', status: 'CONFIRMED', attendedDaysAgo: 5 },
  { key: '12', org: 4, provider: 8, amountMajor: 13.5, feeBasisMinor: 45000, tender: null, status: 'WAIVED', attendedDaysAgo: 15 },
];
export const chargeId = (key: string) => `${IDS.charge}${key}`;
export const appointmentId = (key: string) => `${IDS.appointment}${key}`;

/** What a claim event carries (kiorex-contracts COMMISSION_CHARGE_* data). `amount` is in major units, as the Clinic sends it. */
export function claimEventData(c: DemoClaimSpec, status: string): Record<string, unknown> {
  const org = ORGS.find((o) => o.n === c.org)!;
  const attendedAt = new Date(Date.now() - c.attendedDaysAgo * 86_400_000).toISOString();
  return {
    chargeId: chargeId(c.key), appointmentId: appointmentId(c.key), amount: c.amountMajor, currency: 'EGP', status, tenantId: tenantId(org.n), clinicId: clinicId(org.n), market: 'EG',
    origin: 'MARKETPLACE', feeBasisMinor: c.feeBasisMinor, attendedAt, ...(c.tender ? { tender: c.tender } : {}), ...(c.tenderMethod ? { tenderMethod: c.tenderMethod } : {}), ...(c.tenderDetail ? { tenderDetail: c.tenderDetail } : {}),
    ...(status === 'CONFIRMED' ? { confirmedAt: new Date(Date.now() - Math.max(0, c.attendedDaysAgo - 1) * 86_400_000).toISOString() } : {}),
    ...(status === 'DISPUTED' ? { disputeStatus: 'OPEN', disputeDeadline: new Date(Date.now() + 5 * 86_400_000).toISOString() } : {}),
  };
}

/** Event sequence for a claim: CREATED as PENDING, then one status change (or a REVERSED event) when the final status is not PENDING. */
export function claimEvents(c: DemoClaimSpec): { type: string; status: string }[] {
  const seq = [{ type: 'COMMISSION_CHARGE_CREATED', status: 'PENDING' }];
  if (c.status === 'REVERSED') seq.push({ type: 'COMMISSION_CHARGE_REVERSED', status: 'REVERSED' });
  else if (c.status !== 'PENDING') seq.push({ type: 'COMMISSION_CHARGE_STATUS_CHANGED', status: c.status });
  return seq;
}

/** Two collection runs written directly (idempotent ids): an open invoice for organisation 1 (cash-type claims) and a settled run for organisation 2 (online claims netted from payouts). */
export const RUNS = [
  { id: `${IDS.run}1`, org: 1, mode: 'INVOICE', status: 'INVOICE_OPEN', claimSet: 'INVOICE' as const, invoiceNo: 'DEMO-INV-0001' },
  { id: `${IDS.run}2`, org: 2, mode: 'DEDUCT_FROM_PAYOUT', status: 'SETTLED', claimSet: 'DEDUCTED' as const, invoiceNo: null },
];

/** Strings that must never appear in this seed's data: dev gate evidence, dev product keys, published dev secrets. A test scans the whole dataset for them. */
export const FORBIDDEN_MARKERS = ['DEV-ONLY-NOT-A-REAL-GATE', 'dev.invalid', 'ff_dev_secret', '_dev', 'kx_dev_', 'change_me'];
