# Test data — Kiorex platform (DEV ONLY)

> **DEV ONLY / synthetic.** Fictional names, phones `+20100000xxxx`, e-mails `@demo.kiorex.test`. Passwords and OTPs here are local dev values, blocked in production.
> No tax-authority integration; VAT is a plain configurable line. Messaging/PSP/video are mocked. Cross-product index: `TEST_DATA.md` in the workspace root (`kiorex-v2/`).

## Run / reset
```bash
cd apps/api
npm run db:seed          # base: flag registry, product keys, partner dev registrations
# prerequisite: Kiorly demo seed + provider sync (scripts/seed-all.sh does both): POST /api/v1/admin/providers/sync?full=true
npm run db:seed:demo               # idempotent
npm run db:seed:demo -- --reset    # removes only demo rows (ids demo_*, kx_ph_demo_*, kx_lb_demo_*, subs 01HZKXD*), then re-creates
```
Bookings `demo_bk_<key>` mirror the Kiorly appointments `demo_mk_<key>` created from `prisma/demo/demo-marketplace-bookings.json` (byte-identical copy lives in clinics-management). Pharmacy/Lab orders reference the real partner branch/lab ids fetched over the signed partner API (skipped with a warning if a partner is down).
Gate evidence is recorded only as **DEV-ONLY-NOT-A-REAL-GATE** in this dev DB (telemedicine, pharmacy orders, lab bookings, AI navigation, 3 specialty templates).

## Logins — patient web http://localhost:5180, Expo web http://localhost:8081, ops http://localhost:5181
Phone OTP `000000` (see Passport). Patients `+201000001001 … +201000001012` (Hoda `…1001` has two dependants and the richest history). Ops super admin `+201000000099` + TOTP `<local seed +201000000099>`; ops admin `+201000009001`, finance `+201000009002`, support `+201000009003`.
## What exists
12 patient profiles + 4 dependants + Kiorly links + consents · 28 bookings (completed 11, confirmed 10, cancelled 3, no-show 1, held 1, pending clinic 1, checked-in 1) with events · deposits (paid, released, forfeited, refunded, awaiting) via sandbox-fake PSP, double-entry ledger (capture, PSP fee, release, refund request/settle, payout) and payouts · reviews with clinic replies (one hidden) and provider rating aggregates · vault: visit summaries, prescriptions with QR, an uploaded ECG, share consents, follow-ups · waitlist entries/offers · telemedicine sessions · message log (queued/sent/delivered/read/failed) · 8 pharmacy orders and 8 lab bookings in every state · flags: a few explicit values incl. non-defaults (not the WhatsApp channel: switching `kiorex.whatsapp_booking` OFF suppresses clinic-cancel notifications that e2e 07 asserts).
## Where to click
Patient web: Search, My bookings, Vault, Family, Waitlist, Pharmacy/Lab orders, Telemedicine. Ops: Providers, Bookings, Payments/Ledger/Payouts, Reviews, Messages, Outbox, Partners, Flags.
## Notes
`kiorex.sponsored_listings` OFF at market EG may stay pending (money-path flag, two-person rule). Held bookings may be expired by the background job over time.

## Rev 2.3 additions (home visits) — `prisma/demo/seed-home.ts`, spec `prisma/demo/demo-home-visits.json`
Needs the Kiorly demo seed and a provider sync (scripts/seed-all.sh does both). Patients: Hoda `+201000001001` (home + mother's flat addresses, family share, home bookings incl. a cancelled refunded one), Samir `…1002`, Nourhan `…1004`, Mahmoud `…1005`, Dalia `…1008`, Rana `…1012`, Karim `…1003` (physio), new **Nabila Hamdy `+201000001013`** (agency care-plan client). OTP `000000`.
- **Providers (synced)**: Nurse Mona Adel (solo), Demo Care Agency (`assignsClinician`), Dr Mai Hassan and Dr Hany Sobhy (physiotherapy, home), Dr Nadia Fouad (paediatrician, home).
- **Address book** (`PatientAddress`, encrypted): confirmed defaults, an unconfirmed and a soft-deleted address for Hoda; booking address snapshots masked 24 h after the visit.
- **32 home bookings**: assigned (assignee shown), unassigned agency queue (`assignmentPending`), en route (ETA), arrived, completed, aborted-unsafe (not a no-show), cancelled (refund), no-show (forfeit); care plan `kx_cp_demo_1` (10 visits, 4 done) + request `kx_cp_demo_2`.
- **Deposits**: paid / released / forfeited / refunded, **hold-for-review** (2 held, 35 min and 46 h old), reviewed->released, reviewed->refunded; ledger entries follow the real postings (HOLD_FOR_REVIEW, REVIEW_RELEASE, REVIEW_REFUND_REQUEST).
- **Ops console -> Safety console**: 6 alerts (SOS resolved, timer-expired acknowledged, unsafe-abort raised / escalated with a 95 s SLO breach / resolved x2) with action history; family shares (2 active, 1 stopped).
- **Gate evidence**: DEV-ONLY-NOT-A-REAL-GATE:GHV1/GHV2/GPR1/GPR2/GKN1/GKN2 for the home, physio, care-plan/MAR and solo-nurse flags (dev DB only, never a real approval; the base seed intentionally leaves GKN1/GKN2 unrecorded).
- `DEMO_SEED_NOW` (set by seed-all.sh) anchors the live visits to the same instant as the Kiorly seed.

## All 36 specialties: 72 demo doctors, searchable and bookable (added 22 Nov 2026)

DEV ONLY, synthetic. Every specialty of the Kiorex catalogue (`GET :4000/api/v1/specialties`, 36 codes) has **2 LIVE, verified doctors** in the new Kiorly demo tenant `demo_t_sp` "Kiorex Specialties Network (DEMO)" (3 branches: New Cairo `demo_c_sp_cairo`, Dokki `demo_c_sp_giza`, Alexandria/Smouha `demo_c_sp_alex`; 72 doctors, 40 + 12 persona patients, working days every day except Friday (12 doctors also close Saturday), 09:00-13:00 and 16:00-20:00 Cairo time, so every doctor has real bookable future slots; about 2,480 appointments, about 600 signed encounters). Gender mix 36 M / 36 F; languages ar, ar+en, ar+en+fr, ar+en+de; fees 300-1000 EGP. **14 doctors also take home visits** (the "Home" column: both physiotherapists, plus doctor A of family medicine, internal medicine, paediatrics, geriatrics, cardiology, pulmonology, diabetes, neurology, nutrition, ob-gyn, sports medicine, rheumatology; coverage districts: New Cairo branch `new-cairo nasr-city heliopolis maadi`, Dokki `dokki mohandessin agouza`, Smouha `smouha sidi-gaber`; HOME visit type fee = 1.2 x consultation + 150 EGP surcharge, deposit 200). **Video (mock) visits**: 11 confirmed bookings are flagged "(video)" (psychiatry, nutrition, family medicine, dermatology, diabetes, allergy, infectious diseases, geriatrics, rheumatology, pain management, audiology) and 2 ended sessions (psychiatry, nutrition) exist as `TeleSession` rows (`kiorex.telemedicine` is ON, video provider `mock`).

**Per specialty 3 Kiorex bookings** (108 in total, keys `spNNa/b/c` in `prisma/demo/demo-marketplace-bookings.json`, mirrored byte-identical in both repos) for the demo patients Hoda `+201000001001` ... Rana `+201000001012`: one COMPLETED (with a visit summary and, every second one, a prescription in the patient vault; most carry a review), one CONFIRMED (some with a PAID deposit, some video) and a third that cycles through COMPLETED, CANCELLED (deposit refunded), NO_SHOW (deposit forfeited), PENDING_CLINIC, HELD, CHECKED_IN and CONFIRMED. The table below names which key is which state. Pharmacy and lab orders were NOT added per specialty (they must mirror the partner seeds; the existing 8 + 8 stay).

**How to run it** (idempotent; this is what `scripts/seed-all.sh` does in order): `cd clinics-management && npm run db:seed:demo -w api` (Kiorly), then provider sync (`node scripts/ops-sync.mjs`, or ops console Providers -> Sync), then `cd kiorex-platform && npm run db:seed:demo -w apps/api` (Kiorex). **Kiorly Clinic staff side** (web http://localhost:5174/login or `POST :3010/api/v1/auth/login`), password `Demo@12345`: owner `owner.sp@demo.kiorex.test` (GROUP_ADMIN), `manager.sp@`, `frontdesk1.sp@` / `frontdesk2.sp@` (front desk), `nurse.sp@`, `accountant.sp@`, `callcenter.sp@`, and every doctor as `<key>.sp@demo.kiorex.test` (PHYSICIAN; the key is in the table, e.g. `psychiatrya.sp@demo.kiorex.test`). **Kiorex patient side**: patient web http://localhost:5180 (or Expo web :8081) -> sign in with the demo phone `+201000001001` (Hoda) ... `+201000001012`, OTP `000000` (Passport), then search by specialty; the Kiorex provider id is `demo_l_sp_<key>`. Public Kiorly booking slug: `demo-sp-<key>`. Verified 22 Nov 2026 with `GET /search/providers?specialty=<code>`: all 36 codes return at least 2 providers with `nextSlots` (some codes also return older demo doctors, e.g. paediatrics 5, cardiology 4). The older codes `obstetrics_gynecology` and `physio_therapy` (Nile Care Dr Rania, Dr Mai Hassan) are not folded onto `obgyn` / `physiotherapy` by the provider mapper, so search by those two codes does not show them; the new doctors use the catalogue codes.

| # | Specialty (code) | Doctor (EN / AR) | Gender | Clinic | Home | Langs | Kiorly login / booking slug | Demo bookings (Kiorex) |
|---|---|---|---|---|---|---|---|---|
| 1 | Allergy & Immunology (`allergy_immunology`) | Dr Adel Aziz / د. عادل عزيز | M | New Cairo |  | ar/en | `allergyimmunologya.sp@` / `demo-sp-allergyimmunologya` | `sp01a` done |
|  |  | Dr Amal Fahmy / د. أمل فهمي | F | Dokki |  | ar/en | `allergyimmunologyb.sp@` / `demo-sp-allergyimmunologyb` | `sp01b` confirmed (video), `sp01c` done |
| 2 | Anaesthesiology (`anesthesiology`) | Dr Asmaa Metwally / د. أسماء متولي | F | Dokki |  | ar | `anesthesiologya.sp@` / `demo-sp-anesthesiologya` | `sp02a` done, `sp02b` confirmed |
|  |  | Dr Alaa Refaat / د. علاء رفعت | M | Smouha |  | ar/en/fr | `anesthesiologyb.sp@` / `demo-sp-anesthesiologyb` | `sp02c` cancelled |
| 3 | Audiology & Speech (`audiology`) | Dr Amir Yassin / د. أمير ياسين | M | Smouha |  | ar/en | `audiologya.sp@` / `demo-sp-audiologya` | `sp03a` done |
|  |  | Dr Anas Taha / د. أنس طه | M | New Cairo |  | ar/de/en | `audiologyb.sp@` / `demo-sp-audiologyb` | `sp03b` confirmed (video), `sp03c` no-show |
| 4 | Cardiology (`cardiology`) | Dr Basma Barakat / د. بسمة بركات | F | New Cairo | yes | ar/en | `cardiologya.sp@` / `demo-sp-cardiologya` | `sp04a` done, `sp04b` confirmed |
|  |  | Dr Eman Habib / د. إيمان حبيب | F | Dokki |  | ar/en | `cardiologyb.sp@` / `demo-sp-cardiologyb` | `sp04c` pending clinic |
| 5 | Cardiothoracic Surgery (`cardiothoracic_surgery`) | Dr Ashraf Mounir / د. أشرف منير | M | Dokki |  | ar | `cardiothoracicsurgerya.sp@` / `demo-sp-cardiothoracicsurgerya` | `sp05a` done |
|  |  | Dr Esraa Selim / د. إسراء سليم | F | Smouha |  | ar/en/fr | `cardiothoracicsurgeryb.sp@` / `demo-sp-cardiothoracicsurgeryb` | `sp05b` confirmed, `sp05c` held |
| 6 | Dentistry (`dentistry`) | Dr Farida Shalaby / د. فريدة شلبي | F | Smouha |  | ar/en | `dentistrya.sp@` / `demo-sp-dentistrya` | `sp06a` done, `sp06b` confirmed |
|  |  | Dr Ayman Abbas / د. أيمن عباس | M | New Cairo |  | ar/de/en | `dentistryb.sp@` / `demo-sp-dentistryb` | `sp06c` checked in |
| 7 | Dermatology (`dermatology`) | Dr Bassem Diab / د. باسم دياب | M | New Cairo |  | ar/en | `dermatologya.sp@` / `demo-sp-dermatologya` | `sp07a` done |
|  |  | Dr Emad Kamel / د. عماد كامل | M | Dokki |  | ar/en | `dermatologyb.sp@` / `demo-sp-dermatologyb` | `sp07b` confirmed (video), `sp07c` confirmed |
| 8 | Diabetes & Endocrinology (`diabetes_endocrinology`) | Dr Ghada Okasha / د. غادة عكاشة | F | Dokki | yes | ar | `diabetesendocrinologya.sp@` / `demo-sp-diabetesendocrinologya` | `sp08a` done, `sp08b` confirmed (video) |
|  |  | Dr Hanan Soliman / د. حنان سليمان | F | Smouha |  | ar/en/fr | `diabetesendocrinologyb.sp@` / `demo-sp-diabetesendocrinologyb` | `sp08c` done |
| 9 | Emergency Medicine (`emergency_medicine`) | Dr Essam Gad / د. عصام جاد | M | Smouha |  | ar/en | `emergencymedicinea.sp@` / `demo-sp-emergencymedicinea` | `sp09a` done |
|  |  | Dr Hend Amin / د. هند أمين | F | New Cairo |  | ar/de/en | `emergencymedicineb.sp@` / `demo-sp-emergencymedicineb` | `sp09b` confirmed, `sp09c` cancelled |
| 10 | ENT (`ent`) | Dr Jihan Eissa / د. جيهان عيسى | F | New Cairo |  | ar/en | `enta.sp@` / `demo-sp-enta` | `sp10a` done, `sp10b` confirmed |
|  |  | Dr Fady Maher / د. فادي ماهر | M | Dokki |  | ar/en | `entb.sp@` / `demo-sp-entb` | `sp10c` no-show |
| 11 | internal_medicine (`family_medicine`) | Dr Gamal Rashad / د. جمال رشاد | M | Dokki | yes | ar | `familymedicinea.sp@` / `demo-sp-familymedicinea` | `sp11a` done |
|  |  | Dr Hatem Wahba / د. حاتم وهبة | M | Smouha |  | ar/en/fr | `familymedicineb.sp@` / `demo-sp-familymedicineb` | `sp11b` confirmed (video), `sp11c` pending clinic |
| 12 | Gastroenterology (`gastroenterology`) | Dr Laila Radi / د. ليلى راضي | F | Smouha |  | ar/en | `gastroenterologya.sp@` / `demo-sp-gastroenterologya` | `sp12a` done, `sp12b` confirmed |
|  |  | Dr Lobna Badawy / د. لبنى بدوي | F | New Cairo |  | ar/de/en | `gastroenterologyb.sp@` / `demo-sp-gastroenterologyb` | `sp12c` held |
| 13 | General Surgery (`general_surgery`) | Dr Hazem Ghoneim / د. حازم غنيم | M | New Cairo |  | ar/en | `generalsurgerya.sp@` / `demo-sp-generalsurgerya` | `sp13a` done |
|  |  | Dr Maha Morsy / د. مها مرسي | F | Dokki |  | ar/en | `generalsurgeryb.sp@` / `demo-sp-generalsurgeryb` | `sp13b` confirmed, `sp13c` checked in |
| 14 | Geriatrics (`geriatrics`) | Dr Marwa Saad / د. مروة سعد | F | Dokki | yes | ar | `geriatricsa.sp@` / `demo-sp-geriatricsa` | `sp14a` done, `sp14b` confirmed (video) |
|  |  | Dr Ihab Zahran / د. إيهاب زهران | M | Smouha |  | ar/en/fr | `geriatricsb.sp@` / `demo-sp-geriatricsb` | `sp14c` confirmed |
| 15 | Haematology (`haematology`) | Dr Ismail Younis / د. إسماعيل يونس | M | Smouha |  | ar/en | `haematologya.sp@` / `demo-sp-haematologya` | `sp15a` done |
|  |  | Dr Kamal Darwish / د. كمال درويش | M | New Cairo |  | ar/de/en | `haematologyb.sp@` / `demo-sp-haematologyb` | `sp15b` confirmed, `sp15c` done |
| 16 | Infectious Diseases (`infectious_diseases`) | Dr Mervat Helmy / د. ميرفت حلمي | F | New Cairo |  | ar/en | `infectiousdiseasesa.sp@` / `demo-sp-infectiousdiseasesa` | `sp16a` done, `sp16b` confirmed (video) |
|  |  | Dr Nada Nagy / د. ندى ناجي | F | Dokki |  | ar/en | `infectiousdiseasesb.sp@` / `demo-sp-infectiousdiseasesb` | `sp16c` cancelled |
| 17 | Internal Medicine (`internal_medicine`) | Dr Maged Sharaf / د. ماجد شرف | M | Dokki | yes | ar | `internalmedicinea.sp@` / `demo-sp-internalmedicinea` | `sp17a` done |
|  |  | Dr Nahla Awad / د. نهلة عوض | F | Smouha |  | ar/en/fr | `internalmedicineb.sp@` / `demo-sp-internalmedicineb` | `sp17b` confirmed, `sp17c` no-show |
| 18 | Nephrology (`nephrology`) | Dr Noha Abdelhamid / د. نهى عبد الحميد | F | Smouha |  | ar/en | `nephrologya.sp@` / `demo-sp-nephrologya` | `sp18a` done, `sp18b` confirmed |
|  |  | Dr Marwan El-Banna / د. مروان البنا | M | New Cairo |  | ar/de/en | `nephrologyb.sp@` / `demo-sp-nephrologyb` | `sp18c` pending clinic |
| 19 | Neurology (`neurology`) | Dr Mohab Labib / د. مهاب لبيب | M | New Cairo | yes | ar/en | `neurologya.sp@` / `demo-sp-neurologya` | `sp19a` done |
|  |  | Dr Nabil Qandil / د. نبيل قنديل | M | Dokki |  | ar/en | `neurologyb.sp@` / `demo-sp-neurologyb` | `sp19b` confirmed, `sp19c` held |
| 20 | Neurosurgery (`neurosurgery`) | Dr Nesma Tantawy / د. نسمة طنطاوي | F | Dokki |  | ar | `neurosurgerya.sp@` / `demo-sp-neurosurgerya` | `sp20a` done, `sp20b` confirmed |
|  |  | Dr Rasha Hosny / د. رشا حسني | F | Smouha |  | ar/en/fr | `neurosurgeryb.sp@` / `demo-sp-neurosurgeryb` | `sp20c` checked in |
| 21 | Nutrition & Dietetics (`nutrition`) | Dr Osama Aziz / د. أسامة عزيز | M | Smouha | yes | ar/en | `nutritiona.sp@` / `demo-sp-nutritiona` | `sp21a` done (video) |
|  |  | Dr Rehab Fahmy / د. رحاب فهمي | F | New Cairo |  | ar/de/en | `nutritionb.sp@` / `demo-sp-nutritionb` | `sp21b` confirmed (video), `sp21c` confirmed |
| 22 | Obstetrics & Gynaecology (`obgyn`) | Dr Reham Metwally / د. ريهام متولي | F | New Cairo | yes | ar/en | `obgyna.sp@` / `demo-sp-obgyna` | `sp22a` done, `sp22b` confirmed |
|  |  | Dr Raafat Refaat / د. رأفت رفعت | M | Dokki |  | ar/en | `obgynb.sp@` / `demo-sp-obgynb` | `sp22c` done |
| 23 | Oncology (`oncology`) | Dr Ramy Yassin / د. رامي ياسين | M | Dokki |  | ar | `oncologya.sp@` / `demo-sp-oncologya` | `sp23a` done |
|  |  | Dr Sameh Taha / د. سامح طه | M | Smouha |  | ar/en/fr | `oncologyb.sp@` / `demo-sp-oncologyb` | `sp23b` confirmed, `sp23c` cancelled |
| 24 | Ophthalmology (`ophthalmology`) | Dr Sahar Barakat / د. سحر بركات | F | Smouha |  | ar/en | `ophthalmologya.sp@` / `demo-sp-ophthalmologya` | `sp24a` done, `sp24b` confirmed |
|  |  | Dr Samar Habib / د. سمر حبيب | F | New Cairo |  | ar/de/en | `ophthalmologyb.sp@` / `demo-sp-ophthalmologyb` | `sp24c` no-show |
| 25 | Orthopaedics (`orthopaedics`) | Dr Seif Mounir / د. سيف منير | M | New Cairo |  | ar/en | `orthopaedicsa.sp@` / `demo-sp-orthopaedicsa` | `sp25a` done |
|  |  | Dr Shaimaa Selim / د. شيماء سليم | F | Dokki |  | ar/en | `orthopaedicsb.sp@` / `demo-sp-orthopaedicsb` | `sp25b` confirmed, `sp25c` pending clinic |
| 26 | Paediatrics (`paediatrics`) | Dr Shereen Shalaby / د. شيرين شلبي | F | Dokki | yes | ar | `paediatricsa.sp@` / `demo-sp-paediatricsa` | `sp26a` done, `sp26b` confirmed |
|  |  | Dr Wael Abbas / د. وائل عباس | M | Smouha |  | ar/en/fr | `paediatricsb.sp@` / `demo-sp-paediatricsb` | `sp26c` held |
| 27 | Pain Management (`pain_management`) | Dr Yehia Diab / د. يحيى دياب | M | Smouha |  | ar/en | `painmanagementa.sp@` / `demo-sp-painmanagementa` | `sp27a` done |
|  |  | Dr Zein Kamel / د. زين كامل | M | New Cairo |  | ar/de/en | `painmanagementb.sp@` / `demo-sp-painmanagementb` | `sp27b` confirmed (video), `sp27c` checked in |
| 28 | Physiotherapy (`physiotherapy`) | Dr Soha Okasha / د. سها عكاشة | F | New Cairo | yes | ar/en | `physiotherapya.sp@` / `demo-sp-physiotherapya` | `sp28a` done, `sp28b` confirmed |
|  |  | Dr Suzan Soliman / د. سوزان سليمان | F | Dokki | yes | ar/en | `physiotherapyb.sp@` / `demo-sp-physiotherapyb` | `sp28c` confirmed |
| 29 | Plastic & Cosmetic Surgery (`plastic_surgery`) | Dr Ziad Gad / د. زياد جاد | M | Dokki |  | ar | `plasticsurgerya.sp@` / `demo-sp-plasticsurgerya` | `sp29a` done |
|  |  | Dr Walaa Amin / د. ولاء أمين | F | Smouha |  | ar/en/fr | `plasticsurgeryb.sp@` / `demo-sp-plasticsurgeryb` | `sp29b` confirmed, `sp29c` done |
| 30 | Psychiatry (`psychiatry`) | Dr Yasmine Eissa / د. ياسمين عيسى | F | Smouha |  | ar/en | `psychiatrya.sp@` / `demo-sp-psychiatrya` | `sp30a` done (video), `sp30b` confirmed (video) |
|  |  | Dr Magdy Maher / د. مجدي ماهر | M | New Cairo |  | ar/de/en | `psychiatryb.sp@` / `demo-sp-psychiatryb` | `sp30c` cancelled |
| 31 | Pulmonology & Chest (`pulmonology`) | Dr Sabry Rashad / د. صبري رشاد | M | New Cairo | yes | ar/en | `pulmonologya.sp@` / `demo-sp-pulmonologya` | `sp31a` done |
|  |  | Dr Hesham Wahba / د. هشام وهبة | M | Dokki |  | ar/en | `pulmonologyb.sp@` / `demo-sp-pulmonologyb` | `sp31b` confirmed, `sp31c` no-show |
| 32 | Radiology (`radiology`) | Dr Zeinab Radi / د. زينب راضي | F | Dokki |  | ar | `radiologya.sp@` / `demo-sp-radiologya` | `sp32a` done, `sp32b` confirmed |
|  |  | Dr Doaa Badawy / د. دعاء بدوي | F | Smouha |  | ar/en/fr | `radiologyb.sp@` / `demo-sp-radiologyb` | `sp32c` pending clinic |
| 33 | Rheumatology (`rheumatology`) | Dr Moataz Ghoneim / د. معتز غنيم | M | Smouha | yes | ar/en | `rheumatologya.sp@` / `demo-sp-rheumatologya` | `sp33a` done |
|  |  | Dr Radwa Morsy / د. رضوى مرسي | F | New Cairo |  | ar/de/en | `rheumatologyb.sp@` / `demo-sp-rheumatologyb` | `sp33b` confirmed (video), `sp33c` held |
| 34 | Sports Medicine (`sports_medicine`) | Dr Manal Saad / د. منال سعد | F | New Cairo | yes | ar/en | `sportsmedicinea.sp@` / `demo-sp-sportsmedicinea` | `sp34a` done, `sp34b` confirmed |
|  |  | Dr Nader Zahran / د. نادر زهران | M | Dokki |  | ar/en | `sportsmedicineb.sp@` / `demo-sp-sportsmedicineb` | `sp34c` checked in |
| 35 | Urology (`urology`) | Dr Ragab Younis / د. رجب يونس | M | Dokki |  | ar | `urologya.sp@` / `demo-sp-urologya` | `sp35a` done |
|  |  | Dr Abdallah Darwish / د. عبد الله درويش | M | Smouha |  | ar/en/fr | `urologyb.sp@` / `demo-sp-urologyb` | `sp35b` confirmed, `sp35c` confirmed |
| 36 | Vascular Surgery (`vascular_surgery`) | Dr Lamis Helmy / د. لميس حلمي | F | Smouha |  | ar/en | `vascularsurgerya.sp@` / `demo-sp-vascularsurgerya` | `sp36a` done, `sp36b` confirmed |
|  |  | Dr Salwa Nagy / د. سلوى ناجي | F | New Cairo |  | ar/de/en | `vascularsurgeryb.sp@` / `demo-sp-vascularsurgeryb` | `sp36c` done |

## Seeding staging on AWS (non-production only; written, never applied)
Nothing here deploys anything. A human first deploys the staging stacks and pushes the seed images, then seeds by hand:
1. `enable_demo_seed = true` is set **only** in the staging `terraform.tfvars` (default `false`, prod `false`; a plan with `env = "prod"` and `enable_demo_seed = true` **fails** a precondition, tested offline by `infra/tofu/modules/product-stack/tests/demo_seed_guard.tftest.hcl` via `tofu test`). It creates a container-image Lambda `<product>-staging-demo-seed` in the isolated subnets with DB access and least-privilege IAM (read the DB secret + the runtime secrets, decrypt with the secrets key, nothing else); OpenTofu never invokes it.
2. Build and push the seed image (`apps/api/Dockerfile.seed`, tag = the deploy git sha) to the `<name>-seed` ECR repo, then run `tofu apply` for staging as usual.
3. From the workspace root run `scripts/seed-staging.sh --dry-run` (prints the plan), then `scripts/seed-staging.sh --yes` (order: Passport Cognito users, Kiorly Clinic, Pharmacy, Lab, Kiorex provider sync, Kiorex). `--reset` removes and re-creates the demo records only; `--only lab,kiorex` re-runs selected steps. The script refuses any AWS account other than the staging one. Single product: `tofu output demo_seed_invoke`.
4. Image: `apps/api/Dockerfile.seed` (`npm run build:seed -w apps/api`; entrypoints `dist-seed/prisma/seed.js`, `dist-seed/prisma/demo/provider-sync.js` (step `sync`) and `dist-seed/prisma/demo/seed-demo.js`). The Lambda event carries `DEMO_SUB_MAP_JSON`, `DEMO_HANDOFF_JSON` (the Lab seed's hand-off for the KNLAB01 nurse samples), `KIORLY_BASE_URL`, `LAB_BASE_URL`. `scripts/seed-staging.sh` is copied here from the workspace root (same file).
**Guard (every seed entrypoint, `src/common/demo-seed-guard.ts`; `scripts/demo-seed-guard.ts` in kiorex-account):** the demo seed runs only when `DEMO_SEED_ALLOWED=true` **and** the environment is declared non-production (`KIORLY_ENV` / `KIOREX_ENV` / `ENV_TAG`, the `Env` tag OpenTofu sets; `NODE_ENV` is only a fallback because staging containers run with `NODE_ENV=production`). It fails closed: any variable saying prod/production/live, an unknown environment name, an undeclared environment under `NODE_ENV=production`, a database whose host/name looks like production, or any "allow in prod" override all refuse. It logs a banner (environment + database name, never credentials). Local `npm run` scripts set `DEMO_SEED_ALLOWED=true` for you; `scripts/seed-all.sh` also sets `KIORLY_ENV=local`. Tests: `demo-seed-guard.node.test.ts` (jest/vitest equivalent in platform/account).
Mock providers stay mock on staging (`MODE=mock`, PSP `sandbox-fake`, messaging `log`), so every seeded flow works without real providers. Cognito generates user subs, so the Passport step writes a phone-to-sub map that the Clinic / Pharmacy / Kiorex seeds take as `DEMO_SUB_MAP_JSON` (seed-staging.sh passes it). Families, organisations, invitations, link requests and TOTP of the Passport demo exist only in the local dev IdP DB (the AWS Passport stack is Cognito only): on staging the guardian/org Passport screens are not seeded.
Known limits: Kiorex's provider sync and the Nurse-lab push-back call Kiorly Clinic/Lab over HTTPS and need the egress path HB07 from the isolated subnets (until then those steps warn and the Kiorex data is seeded without the clinic mirror). Seeding Kiorex needs the platform's `KIORLY_CLIENT_KEY/SECRET` runtime secrets. The seed images could not be built in this session (Docker daemon not running): build them once before the first run.

## Q10 additions: KNLAB01 nurse-lab relay, care-plan request states (`prisma/demo/seed-nurse-lab.ts`, spec `demo-nurse-lab.json`)
`NurseLabRelay` rows `demo_lo_nl1..4` (RESULT_RELEASED / SUBMITTED x2 / REFUSED `SAMPLE_UNMATCHED`) with the lab order ids and numbers taken from the Lab seed's hand-off (`DEMO_HANDOFF_FILE` locally, `DEMO_HANDOFF_JSON` on AWS), then the lab status + sanitized custody + report link are pushed to the clinic over the signed API (needs Kiorly Clinic reachable; otherwise a warning and the clinic stays HANDED_OFF). Care-plan bookings now cover CONFIRMED (`kx_cp_demo_1`), REQUESTED (`kx_cp_demo_2`) and REJECTED (`kx_cp_demo_3`). `DEMO_SUB_MAP_JSON` maps demo phones to the real (Cognito) subs on AWS. Compiled one-shots: `npm run build:seed -w apps/api` then `node dist-seed/prisma/demo/provider-sync.js` and `node dist-seed/prisma/demo/seed-demo.js`.
