/**
 * Full feature-flag catalogue — KX-08 §09 (all products). Every flag defaults ON; launch-locked flags are
 * effective only with gate evidence (ADR-024). Safety controls are NEVER flags (ADR-025, see safety-controls.ts).
 */
export type FlagClass = 'MODULE' | 'COMMERCIAL' | 'INTEGRATION' | 'AI' | 'LAUNCH_LOCKED';
export type FlagScope = 'GLOBAL' | 'MARKET' | 'ORG';
/** `kiorly-nurse` keys (KX-23) are catalogue entries of the NURSE edition; Nurse runs inside the Clinic runtime, so they are SERVED in the `kiorly-clinic` snapshot (kiorex-contracts 1.5.0 CHANGELOG, Assumptions). */
export type FlagProduct = 'kiorly-clinic' | 'kiorly-nurse' | 'kiorex' | 'kiorex-account' | 'kiorly-pharmacy' | 'kiorly-lab' | 'all';

export interface FlagDef {
  key: string;
  product: FlagProduct;
  class: FlagClass;
  scopes: FlagScope[];
  dependsOn: string[];
  description: string;
  whenOff: string;
  launchLocked?: boolean;
  gateHint?: string;
  /** Money-path flags: global/market OFF needs two-person approval (KXM-OP-10). */
  moneyPath?: boolean;
  /** Gate ids that must ALL have human-recorded evidence before a launch-locked flag is effective (e.g. GHV1 + GHV2). Labels only: no gate is ever recorded by code. */
  gateIds?: string[];
  /** NURSE for nurse.* keys (metadata only; the evaluator is unchanged). */
  edition?: 'NURSE';
}

const GMO: FlagScope[] = ['GLOBAL', 'MARKET', 'ORG'];
const GM: FlagScope[] = ['GLOBAL', 'MARKET'];
const g = (key: string, product: FlagProduct, cls: FlagClass, scopes: FlagScope[], dependsOn: string[], whenOff: string, extra: Partial<FlagDef> = {}): FlagDef => ({
  key, product, class: cls, scopes, dependsOn, whenOff, description: key, ...extra,
});

export const SPECIALTY_TEMPLATE_CODES = ['dermatology', 'paediatrics', 'obgyn', 'orthopaedics', 'ent', 'internal_medicine', 'cardiology', 'psychiatry', 'ophthalmology', 'urology', 'dentistry'];
/** KX-05 §07: the physio template is launch-locked until GPR2 (specialty board incl. a physiotherapist reviewer). */
export const PHYSIO_TEMPLATE_CODE = 'physio';

export const FLAG_CATALOGUE: FlagDef[] = [
  // ── Kiorly Clinic
  g('clinic.kiorex_listing', 'kiorly-clinic', 'MODULE', GMO, ['kiorex.marketplace'], 'Listings PAUSED on Kiorex; confirmed bookings honoured; booking link still works'),
  g('clinic.commission_settlement', 'kiorly-clinic', 'COMMERCIAL', GM, ['clinic.kiorex_listing'], 'New commission charges stop; invoices = subscription only; confirmed charges still settle', { moneyPath: true }),
  g('clinic.kiorly_pay_deposits', 'kiorly-clinic', 'COMMERCIAL', GMO, [], 'No new deposit requirements or links; existing deposits refund/convert per policy', { moneyPath: true }),
  g('whatsapp_reminders', 'kiorly-clinic', 'INTEGRATION', GMO, [], 'Reminders stop; manual call list shown'),
  g('clinic.whatsapp_inbound', 'kiorly-clinic', 'INTEGRATION', GMO, ['whatsapp_reminders'], 'Replies no longer change appointments; routed to inbox'),
  g('instapay', 'kiorly-clinic', 'INTEGRATION', GMO, [], 'Method hidden at cashier; cash and other methods remain', { moneyPath: true }),
  g('fawry', 'kiorly-clinic', 'INTEGRATION', GMO, [], 'Method hidden at cashier; cash and other methods remain', { moneyPath: true }),
  g('card_payments', 'kiorly-clinic', 'INTEGRATION', GMO, [], 'Method hidden at cashier; cash and other methods remain', { moneyPath: true }),
  g('ai_assistant', 'kiorly-clinic', 'AI', GMO, [], 'Widget hidden; chat returns 403'),
  g('clinic.ai_scribe', 'kiorly-clinic', 'AI', GMO, [], 'Record button hidden; signed notes unaffected'),
  g('clinic.whatsapp_ai_receptionist', 'kiorly-clinic', 'LAUNCH_LOCKED', GMO, ['clinic.whatsapp_inbound'], 'Inbound messages go to human inbox', { launchLocked: true, gateHint: 'Meta approval + consent copy' }),
  g('clinic.no_show_risk', 'kiorly-clinic', 'AI', GMO, [], 'Risk chip hidden'),
  g('clinic.waitlist_autofill', 'kiorly-clinic', 'MODULE', GMO, ['whatsapp_reminders'], 'Waitlist kept; no automatic offers'),
  g('clinic.record_share_patient_app', 'kiorly-clinic', 'MODULE', GMO, ['kiorex.record_vault'], 'No new shares; existing shares stay visible to the patient'),
  g('clinic.eprescription_handoff', 'kiorly-clinic', 'MODULE', GMO, ['pharmacy.module'], 'Rx printed / WhatsApp only'),
  g('clinic.lab_order_handoff', 'kiorly-clinic', 'MODULE', GMO, ['lab.module'], 'Lab orders kept as records only'),
  g('clinic.payers_tpa', 'kiorly-clinic', 'MODULE', GMO, [], 'Contract prices kept; no new claims'),
  ...SPECIALTY_TEMPLATE_CODES.map((c) =>
    g(`clinic.specialty_templates.${c}`, 'kiorly-clinic', 'LAUNCH_LOCKED', GM, [], 'Template hidden from new encounters', { launchLocked: true, gateHint: 'Specialty board sign-off (NH010)' }),
  ),
  g(`clinic.specialty_templates.${PHYSIO_TEMPLATE_CODE}`, 'kiorly-clinic', 'LAUNCH_LOCKED', GM, [], 'Template hidden from new encounters', { launchLocked: true, gateIds: ['GPR2'], gateHint: 'Specialty board incl. a physiotherapist reviewer (GPR2)' }),
  // ── Rev 2.3 (KX-05 §06-08, KX-23 §09): professions and home visits, shared by the Clinic and Nurse editions
  g('clinic.profession.physiotherapy', 'kiorly-clinic', 'MODULE', GM, [], 'No new physio sign-ups; existing physios keep working'),
  g('clinic.home_visits', 'kiorly-clinic', 'LAUNCH_LOCKED', GMO, [], 'Home visit types hidden for new bookings; booked visits honoured', { launchLocked: true, gateIds: ['GHV1', 'GHV2'], gateHint: 'GHV1 counsel memo + GHV2 CMO home-visit safety protocol' }),
  g('clinic.home_route_view', 'kiorly-clinic', 'MODULE', GMO, ['clinic.home_visits'], 'List view only'),
  g('clinic.home_dispatch', 'kiorly-clinic', 'MODULE', GMO, ['clinic.home_visits'], 'Manual assignment'),
  g('clinic.referral_rewards', 'kiorly-clinic', 'COMMERCIAL', GM, [], 'No new codes; earned credits honoured'),
  g('clinic.field_rep_onboarding', 'kiorly-clinic', 'COMMERCIAL', GM, [], 'Rep codes rejected at signup; earned commissions honoured'),
  // ── Kiorex
  g('kiorex.marketplace', 'kiorex', 'MODULE', GM, [], 'Search shows clinic phone only; no new bookings; existing bookings honoured'),
  g('kiorex.pay_deposits', 'kiorex', 'COMMERCIAL', GM, ['kiorex.marketplace'], 'Deposit-required visit types bookable without deposit or hidden (per market setting)', { moneyPath: true }),
  g('kiorex.reviews', 'kiorex', 'MODULE', GM, ['kiorex.marketplace'], 'No new reviews; aggregates still displayed'),
  g('kiorex.family_accounts', 'kiorex', 'MODULE', GM, [], 'Existing dependants kept; cannot add new'),
  g('kiorex.record_vault', 'kiorex', 'MODULE', GM, [], 'Vault read-only'),
  g('kiorex.whatsapp_booking', 'kiorex', 'INTEGRATION', GM, ['kiorex.marketplace'], 'WhatsApp replies with app link'),
  g('kiorex.sponsored_listings', 'kiorex', 'COMMERCIAL', GM, ['kiorex.marketplace'], 'Sponsored slots removed; organic ranking only', { moneyPath: true }),
  g('kiorex.pharmacy_orders', 'kiorex', 'LAUNCH_LOCKED', GM, ['pharmacy.kiorex_orders'], 'Pharmacy tab hidden; open orders completed or refunded', { launchLocked: true, gateHint: 'Merchant-of-record + counsel memo (Q5)', moneyPath: true }),
  g('kiorex.lab_bookings', 'kiorex', 'LAUNCH_LOCKED', GM, ['lab.kiorex_bookings'], 'Lab tab hidden; booked collections honoured', { launchLocked: true, gateHint: 'Counsel memo', moneyPath: true }),
  g('kiorex.telemedicine', 'kiorex', 'LAUNCH_LOCKED', GM, [], 'Video option hidden', { launchLocked: true, gateHint: 'Clinical governance sign-off' }),
  g('kiorex.ai_navigation', 'kiorex', 'LAUNCH_LOCKED', GM, [], 'Plain specialty search', { launchLocked: true, gateHint: 'Clinical evaluation (KX11)' }),
  g('kiorex.home_visits', 'kiorex', 'LAUNCH_LOCKED', GM, ['clinic.home_visits'], 'Home filter hidden; booked home visits honoured', { launchLocked: true, gateIds: ['GHV1', 'GHV2'], gateHint: 'GHV1 counsel memo + GHV2 CMO safety protocol; >=50 home-enabled providers per launch cluster; safety console live', moneyPath: true }),
  g('kiorex.category.physiotherapy', 'kiorex', 'LAUNCH_LOCKED', GM, [], 'Physio providers not shown', { launchLocked: true, gateIds: ['GPR1'], gateHint: 'GPR1 (physiotherapy category)' }),
  g('kiorex.category.nursing', 'kiorex', 'MODULE', GM, ['kiorex.home_visits', 'nurse.edition'], 'Home nursing not shown'),
  g('kiorex.visit_tracking', 'kiorex', 'MODULE', GM, ['kiorex.home_visits'], 'Status timeline without on-the-way updates'),
  // ── Kiorly Nurse (edition of Kiorly Clinic, KX-23 / ADR-031): served in the kiorly-clinic snapshot
  g('nurse.edition', 'kiorly-nurse', 'MODULE', GM, [], 'No new Nurse sign-ups; existing tenants read-only with export', { edition: 'NURSE' }),
  g('nurse.individual_tenants', 'kiorly-nurse', 'COMMERCIAL', GM, ['nurse.edition'], 'Solo plans hidden at sign-up; existing solos keep working', { edition: 'NURSE' }),
  g('nurse.care_plans', 'kiorly-nurse', 'LAUNCH_LOCKED', GMO, [], 'Single visits only; active plans complete', { launchLocked: true, gateIds: ['GKN1'], gateHint: 'GKN1 CMO + nursing advisor sign-off', edition: 'NURSE' }),
  g('nurse.mar', 'kiorly-nurse', 'LAUNCH_LOCKED', GMO, [], 'Medication recorded as free text in the visit record', { launchLocked: true, gateIds: ['GKN1'], gateHint: 'GKN1 CMO + nursing advisor sign-off', edition: 'NURSE' }),
  g('nurse.private_duty_shifts', 'kiorly-nurse', 'MODULE', GMO, ['nurse.edition'], 'Shift booking hidden', { edition: 'NURSE' }),
  g('nurse.family_updates', 'kiorly-nurse', 'INTEGRATION', GMO, ['whatsapp_reminders'], 'No family messages', { edition: 'NURSE' }),
  g('nurse.individual_kiorex_listing', 'kiorly-nurse', 'LAUNCH_LOCKED', GM, ['kiorex.home_visits'], 'Solo nurses not listed on Kiorex', { launchLocked: true, gateIds: ['GKN2'], gateHint: 'GKN2 counsel memo on independent home nursing (Q7)', edition: 'NURSE' }),
  // ── Kiorex Account
  g('account.passkeys', 'kiorex-account', 'MODULE', GM, [], 'OTP only'),
  g('account.provider_sso', 'kiorex-account', 'MODULE', GMO, [], 'Providers use product login'),
  // ── Kiorly Pharmacy
  g('pharmacy.module', 'kiorly-pharmacy', 'MODULE', GMO, [], 'No new sign-ups; existing tenants read-only with export'),
  g('pharmacy.kiorex_orders', 'kiorly-pharmacy', 'MODULE', GMO, ['pharmacy.module'], 'Order inbox hidden; stock not exposed'),
  g('pharmacy.forecasting', 'kiorly-pharmacy', 'AI', GMO, ['pharmacy.module'], 'Min/max reorder only'),
  g('pharmacy.insurer_claims', 'kiorly-pharmacy', 'MODULE', GMO, ['pharmacy.module'], 'Cash/self-pay only'),
  // ── Kiorly Lab
  g('lab.module', 'kiorly-lab', 'MODULE', GMO, [], 'No new sign-ups; existing tenants read-only with export'),
  g('lab.analyzer_interfaces', 'kiorly-lab', 'INTEGRATION', GMO, ['lab.module'], 'Manual entry with dual control'),
  g('lab.home_collection', 'kiorly-lab', 'MODULE', GMO, ['lab.module'], 'Walk-in collection only'),
  g('lab.kiorex_bookings', 'kiorly-lab', 'MODULE', GMO, ['lab.module'], 'Not bookable from Kiorex'),
  // ── All products: market.<country>.live (Egypt seeded; more via admin definitions endpoint)
  g('market.eg.live', 'all', 'LAUNCH_LOCKED', ['GLOBAL'], [], 'Country hidden from sign-up and search; existing tenants unaffected', { launchLocked: true, gateHint: 'Market pack certification + local counsel' }),
];

export const PRODUCTS: Exclude<FlagProduct, 'all'>[] = ['kiorly-clinic', 'kiorex', 'kiorex-account', 'kiorly-pharmacy', 'kiorly-lab'];

/** Keys evaluated by Kiorex's own modules (flag-OFF contract tests iterate over these). */
export const KIOREX_OWN_FLAGS = FLAG_CATALOGUE.filter((f) => f.product === 'kiorex').map((f) => f.key);
