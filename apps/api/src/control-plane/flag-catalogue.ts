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
  // ── Growth and patient acquisition engine (contracts 1.10.0, ARCH section 16; PROPOSED_DEFAULT: every flag ships ON per ADR-023, counsel-gated ones are launch-locked per ADR-024; safety is never a flag, ADR-025)
  g('growth.provider_links', 'kiorly-clinic', 'MODULE', GMO, [], 'No new links, QR codes or posters can be created; existing links keep resolving and counting; bookings through them stay provider-led and never carry a Kiorex fee'),
  g('growth.attribution', 'kiorex', 'COMMERCIAL', GM, [], 'Every new booking is recorded UNATTRIBUTED and no acquisition block is sent; the CLINIC_LINK rule keeps working; stored decisions stay readable'),
  g('growth.ssr_public_pages', 'kiorex', 'MODULE', GM, [], 'Public routes serve the single-page shell with noindex; sitemaps are empty; existing URLs keep redirecting'),
  g('growth.seo_landing_pages', 'kiorex', 'MODULE', GM, ['growth.ssr_public_pages'], 'Specialty, city and district pages answer 404 with noindex; doctor and clinic pages are unaffected'),
  g('growth.widgets', 'kiorex', 'MODULE', GMO, ['kiorex.marketplace'], 'Embed and SDK answer 403 FEATURE_DISABLED; the provider booking link page keeps working'),
  g('growth.deep_links', 'kiorex', 'MODULE', GM, [], 'Links open the website instead of the app; deep-link files stay served; nothing is hidden'),
  g('growth.analytics_visitor', 'kiorex', 'LAUNCH_LOCKED', GM, [], 'No visitor key or cookie is ever created; only the in-session link token and server-side operational facts are used', { launchLocked: true, gateHint: 'Counsel opinion on Egypt PDPL for analytics cookies and visitor keys + approved consent wording (NEEDS_HUMAN, work-packages section 7 items 1 and 2)' }),
  g('growth.marketing_messaging', 'kiorex', 'LAUNCH_LOCKED', GM, [], 'No marketing message is sent on any channel; transactional, reminder, clinical and security messages are unaffected', { launchLocked: true, gateHint: 'Counsel opinion on direct electronic marketing consent and the reported marketing licence + approved wording (NEEDS_HUMAN)' }),
  g('growth.campaigns', 'kiorex', 'MODULE', GM, ['growth.attribution'], 'Campaign links and budgets are paused; nothing is deleted; attribution of past campaign touches is unchanged'),
  g('growth.patient_referral', 'kiorex', 'LAUNCH_LOCKED', GM, ['growth.attribution'], 'Referral links stop issuing and no new referral relationship starts; qualified rewards already issued stay valid', { launchLocked: true, gateHint: 'Counsel clearance of closed-loop referral rewards and consent wording (NEEDS_HUMAN)' }),
  g('growth.rewards', 'kiorex', 'LAUNCH_LOCKED', GM, ['growth.patient_referral'], 'No new reward credit is issued or applied; existing balances stay visible and expire per policy', { launchLocked: true, gateHint: 'Counsel opinion that closed-loop discount credit is outside stored-value licensing (NEEDS_HUMAN)', moneyPath: true }),
  g('kiorex.whatsapp_ai_assistant', 'kiorex', 'LAUNCH_LOCKED', GM, ['kiorex.whatsapp_booking'], 'The deterministic WhatsApp booking machine answers; no AI orchestration turn runs', { launchLocked: true, gateHint: 'Meta approval + consent copy + clinical-safety review (NEEDS_HUMAN)' }),
  g('growth.experiments', 'kiorex', 'MODULE', GM, ['growth.analytics_visitor'], 'All visitors get the control experience; assignments are not written'),
  // ── Growth Phase 2 (contracts 1.12.0, GRW-P2-X1; same keys, scopes and whenOff text as kiorex-contracts flags/catalogue.json)
  g('growth.campaign_approval_required', 'kiorex', 'MODULE', GM, ['growth.campaigns'], 'Campaign activation no longer needs a second approver below the policy threshold; above CAMPAIGN_POLICY.approvalAboveMinor and for sensitive channels a second approver is still required'),
  g('growth.provider_marketing_v2', 'kiorly-clinic', 'MODULE', GMO, [], 'The provider portal v2 (social templates, shareable slots, statements v2) is hidden; links, QR codes and statements v1 keep working'),
  g('growth.assistant_real_model', 'kiorex', 'LAUNCH_LOCKED', ['GLOBAL'], ['kiorex.whatsapp_ai_assistant'], 'The WhatsApp assistant uses only the deterministic booking machine and the recorded mock model; no real model call is made', { launchLocked: true, gateHint: 'Clinical-safety review of the assistant and the prompt-injection corpus signed by the CMO (NEEDS_HUMAN)' }),
  g('growth.lifecycle_journeys', 'kiorex', 'MODULE', GM, [], 'Lifecycle journeys stop starting; running enrolments end with reason FLAG_OFF; transactional and clinical notifications of the notification layer are unaffected'),
  g('growth.referral_fraud_enforce', 'kiorex', 'MODULE', GM, ['growth.patient_referral'], 'Referral fraud scoring stays in shadow mode: scores and cases are recorded, rewards pass the thresholds that existed before it'),
  ...(['googleads', 'searchconsole', 'ga4', 'playconsole', 'appstoreconnect', 'metaads', 'tiktok', 'whatsappcloud', 'fcmapns', 'crux'] as const).map((k) =>
    g(`growth.integrations.${k}`, 'kiorex', 'INTEGRATION', GM, [], `The ${k} read-only integration stops pulling; stored aggregates stay and the page shows 'not connected'`)),
  // ── Rev 2.6 credit amendment (contracts 1.12.0): patient credit, goodwill, sponsored promotions (all launch-locked), provider credit v2 (Clinic)
  g('growth.patient_credit', 'kiorex', 'LAUNCH_LOCKED', GM, ['growth.rewards'], 'Only coupon mode exists: no patient credit balance is created or applied; existing balances stay visible and expire per policy', { launchLocked: true, gateHint: 'Counsel opinion that closed-loop patient credit is outside stored-value licensing (H-23, NEEDS_HUMAN)' }),
  g('growth.refund_as_credit', 'kiorex', 'LAUNCH_LOCKED', GM, ['growth.patient_credit'], 'The \'keep as credit\' option disappears from the refund flow; every refund goes to the original payment method', { launchLocked: true, gateHint: 'Counsel opinion on refund-as-credit (H-23, NEEDS_HUMAN)' }),
  g('growth.family_credit', 'kiorex', 'LAUNCH_LOCKED', GM, ['growth.patient_credit'], 'Household sharing of patient credit stops; members lose access to the owner\'s credit, nothing moves', { launchLocked: true, gateHint: 'Counsel opinion on household credit (H-23, NEEDS_HUMAN)' }),
  g('growth.support_goodwill', 'kiorex', 'LAUNCH_LOCKED', GM, ['growth.rewards'], 'Support can no longer grant goodwill coupons or credit; existing grants stay valid', { launchLocked: true, gateHint: 'Locked together with growth.rewards (counsel, NEEDS_HUMAN)' }),
  g('growth.sponsored_promotions', 'kiorex', 'LAUNCH_LOCKED', GM, ['growth.attribution'], 'No provider-sponsored promotion is quoted or reserved; running bookings keep their reservation and are settled normally', { launchLocked: true, gateHint: 'Counsel on advertising and accounting for sponsored discounts (H-26 to H-28, NEEDS_HUMAN)' }),
  g('clinic.provider_credit_v2', 'kiorly-clinic', 'MODULE', GMO, [], 'Fee draw-down, dispute-win credit, grants and credit statements are hidden; the credit wallet itself (CR-05) is unchanged'),
  g('clinic.usage_bundles', 'kiorly-clinic', 'COMMERCIAL', GMO, [], 'The prepaid usage bundle skeleton is hidden; no bundle can be bought'),
  // ── Growth Phase 3 wave 8 (GRW-P3-E): mirrored here AHEAD of contracts 1.13.0 so the global kill switch and the launch lock exist today; the 1.13.0 owner must publish the same key, scope, class and whenOff text
  g('growth.automation_journeys', 'kiorex', 'MODULE', GM, ['growth.lifecycle_journeys'], 'The journey builder stops publishing and starting journeys; running enrolments end with AUTOMATION_FLAG_OFF; drafts and reads stay; every MARKETING send still needs growth.marketing_messaging'),
  g('growth.ai_recommendations', 'kiorex', 'LAUNCH_LOCKED', ['GLOBAL'], [], 'No recommendation is generated, approved or rejected and no model summary is requested; stored recommendations stay readable; nothing was ever applied automatically', { launchLocked: true, gateHint: 'KX-11 AI governance review of the recommendation model and prompts (NEEDS_HUMAN); the mock model needs no gate but the feature itself is locked until it is recorded' }),
  // ── Kiorly Nurse (edition of Kiorly Clinic, KX-23 / ADR-031): served in the kiorly-clinic snapshot
  g('nurse.edition', 'kiorly-nurse', 'MODULE', GM, [], 'No new Nurse sign-ups; existing tenants read-only with export', { edition: 'NURSE' }),
  g('nurse.individual_tenants', 'kiorly-nurse', 'COMMERCIAL', GM, ['nurse.edition'], 'Solo plans hidden at sign-up; existing solos keep working', { edition: 'NURSE' }),
  g('nurse.care_plans', 'kiorly-nurse', 'LAUNCH_LOCKED', GMO, [], 'Single visits only; active plans complete', { launchLocked: true, gateIds: ['GKN1'], gateHint: 'GKN1 CMO + nursing advisor sign-off', edition: 'NURSE' }),
  g('nurse.mar', 'kiorly-nurse', 'LAUNCH_LOCKED', GMO, [], 'Medication recorded as free text in the visit record', { launchLocked: true, gateIds: ['GKN1'], gateHint: 'GKN1 CMO + nursing advisor sign-off', edition: 'NURSE' }),
  g('nurse.private_duty_shifts', 'kiorly-nurse', 'MODULE', GMO, ['nurse.edition'], 'Shift booking hidden', { edition: 'NURSE' }),
  g('nurse.family_updates', 'kiorly-nurse', 'INTEGRATION', GMO, ['whatsapp_reminders'], 'No family messages', { edition: 'NURSE' }),
  g('nurse.individual_kiorex_listing', 'kiorly-nurse', 'LAUNCH_LOCKED', GM, ['kiorex.home_visits'], 'Solo nurses not listed on Kiorex', { launchLocked: true, gateIds: ['GKN2'], gateHint: 'GKN2 counsel memo on independent home nursing (Q7)', edition: 'NURSE' }),
  // ── Kiorex Passport
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
