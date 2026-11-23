# Kiorex platform (patient web, patient app, ops console, API): demo data and manual test guide (DEV ONLY)

> **DEV ONLY / synthetic.** Fictional patients, doctors and payments. OTP `000000`, the ops TOTP seeds and every id exist only on the local stack (the demo seed refuses to run in production). **All providers are mocked**: PSP `sandbox-fake`, messaging `log` (rows in the message log / dev inbox), video `mock`, maps `mock` tiles, AI `fake`. Workspace index: [../DEMO_DATA.md](../DEMO_DATA.md) · shared tables: [../TEST_DATA.md](../TEST_DATA.md) · seed reference: [Docs/TEST_DATA.md](Docs/TEST_DATA.md) · identity side: [../kiorex-account/DEMO_DATA.md](../kiorex-account/DEMO_DATA.md).
> Checked against the API on `:4000` (a patient OIDC login and an ops super-admin login with TOTP both succeeded) and the `kiorex_platform` database on 21 Nov 2026. The dev DB is also written by the e2e suites (1,348 booking intents in total, of which 60 are demo), so **counts drift**.

## 1. What this demo is for

The patient marketplace and its operations side: search 22 providers (doctors, physiotherapists, home nurses), book live Kiorly slots with a deposit, see every booking / deposit / refund state, review, keep a record vault, act for family members, join waitlists, take a telemedicine call, order from a pharmacy or book a lab test, book **home visits** and care plans with a live timeline and safety card, and (as ops) watch the money, the outbox, the safety console, held deposits and the feature-flag control plane.

## All 36 specialties (added 22 Nov 2026)
Every Kiorex specialty (36 codes) now has 2 LIVE verified doctors, with bookable slots, 3 demo bookings in varied states, 14 home-visit doctors and 11 video bookings: new Kiorly tenant `demo_t_sp` (72 doctors, staff logins `<key>.sp@demo.kiorex.test` / `Demo@12345`, owner `owner.sp@`), provider-synced into Kiorex, bookings for the demo patients `+201000001001`..`1012` (OTP `000000`). The full specialty -> doctor -> login/slug -> booking table is in [Docs/TEST_DATA.md](Docs/TEST_DATA.md) (section "All 36 specialties"). Seed order is unchanged (`scripts/seed-all.sh`).

## 2. Start and seed

```bash
e2e/scripts/up.sh [--build] [--seed]        # workspace root: Kiorex API :4000 with Passport :4400, Kiorly :3010, Pharmacy :3100, Lab :3200
cd kiorex-platform
npm run dev -w apps/web                      # patient web  http://localhost:5180
npm run dev -w apps/ops                      # ops console  http://localhost:5181
npm run mobile:install && npm run mobile:web # patient app (Expo web) http://localhost:8081  (EXPO_PUBLIC_MOCK=1 = offline fixtures, no API/IdP)
cd apps/api
npm run db:seed                              # base: flag registry, product keys, partner dev registrations
# prerequisites for the demo seed: Kiorly demo seed + provider sync (the workspace script does both)
../../../scripts/seed-all.sh [--reset]       # workspace root (preferred): Passport -> Kiorly -> Pharmacy -> Lab -> provider sync -> Kiorex
npm run db:seed:demo                          # idempotent, this repo only (needs the Kiorly seed and sync first)
npm run db:seed:demo -- --reset               # removes only demo rows (ids demo_*, kx_ph_demo_*, kx_lb_demo_*, subs 01HZKXD*) then re-creates
```

* Do not use the repo-level `npm run dev` while the stack is up (it would start a second API on 4000).
* Sign-in goes through Passport (`http://localhost:4400`, OIDC + PKCE, clients `kiorex-web`, `kiorex-ops`, `kiorex-mobile`); redirect URIs `:5180/auth/callback`, `:5181/auth/callback`.
* Dates are relative to the seed day (-45 ... +14 d). Live home visits are anchored to `DEMO_SEED_NOW`; held bookings and unpaid orders are aged out by background jobs, so a freshly seeded **held** booking becomes EXPIRED after its hold time (it already is: `demo_bk_mk28`). `--reset` re-anchors.
* `kiorex.sponsored_listings` OFF at market EG may stay pending (money-path flag, two-person rule).

## 3. Personas

Patients sign in at `http://localhost:5180` (web) or `:8081` (Expo): "Sign in" -> Passport -> phone -> OTP `000000`. The same phones sign in on Passport; see [../kiorex-account/DEMO_DATA.md](../kiorex-account/DEMO_DATA.md) section 3 for the identity side. Kiorly data for the same people: [../clinics-management/DEMO_DATA.md](../clinics-management/DEMO_DATA.md).

| Phone | Persona | What this persona shows here |
|---|---|---|
| `+201000001001` | Hoda Mahmoud / هدى محمود | richest history: completed Dr Nadia visits (`mk01`, `mk02`), a **held -> expired** booking with Dr Tamer (`mk28`), 2 dependants (Yassin 8y, Laila 4y), 4 saved addresses (confirmed default, mother's flat, one unconfirmed, one deleted), home bookings with Mona (done / cancelled+refunded / assigned / en route), an OFFERED waitlist entry, a telemedicine session ENDED (`demo_ts_mk01`), pharmacy order `kx_ph_demo_1` PENDING_PAYMENT, family status share |
| `+201000001002` | Samir Ali Nassar | co-guardian of Yassin; confirmed (`mk03`) and cancelled+refunded (`mk27`) bookings; telemedicine WAITING (`demo_ts_mk03`); pharmacy `…_2` PAID |
| `+201000001003` | Karim Mostafa | guardian of Salma (15y); completed + confirmed with Dr Ingy (`mk18`, `mk19`); pharmacy `…_3` REJECTED; physio |
| `+201000001004` | Nourhan Fathy / نورهان فتحي | Dr Rania visits (`mk10` completed, `mk11` confirmed, `mk26` **pending clinic** with Dr Medhat); pharmacy `…_4` READY; lab `kx_lb_demo_1` PENDING_PAYMENT; solo-nurse client (Lab consent never asked) |
| `+201000001005` | Mahmoud El-Sayed / محمود السيد | cardiology patient (Dr Tamer `mk07`, `mk08`; Dr Sherif `mk20`), guardian of Adam (2y); pharmacy `…_5` DISPENSED; lab `…_2` PAID; physio 10-session series; care-plan request `kx_cp_demo_2` |
| `+201000001006` | Mariam Adel | Dr Walid `mk04` completed, `mk05` confirmed; telemedicine SCHEDULED (`demo_ts_mk05`); pharmacy `…_6` DISPENSED; lab `…_3` SUBMITTED |
| `+201000001007` | Omar Hegazy | Dr Khaled `mk13`, Dr Hossam `mk16`/`mk17`; pharmacy `…_7` REJECTED; lab `…_4` COLLECTED |
| `+201000001008` | Dalia Ibrahim | **no-show with forfeited deposit** (`mk06`, Dr Walid); pharmacy `…_8` CANCELLED; lab `…_5` RELEASED |
| `+201000001009` | Tarek Zaki | **checked-in** today (`mk09`, Dr Tamer, deposit paid); Dr Sherif `mk21`; lab `…_6` RELEASED |
| `+201000001010` | Heba Salah | cancelled+refunded (`mk12`), Dr Ola `mk23`/`mk24`; lab `…_7` REJECTED |
| `+201000001011` | Youssef Ramadan | Dr Khaled `mk14`, Dr Medhat `mk25`; lab `…_8` CANCELLED |
| `+201000001012` | Rana Khaled / رنا خالد | cancelled+refunded (`mk15`), `mk22`; agency client with Nurse-lab consent revoked |
| `+201000001013` | Nabila Hamdy / نبيلة حمدي | agency home-care client: care plan `kx_cp_demo_1` (10 visits, 4 done) |
| `+201000000099` | Ops Super Admin | ops console `http://localhost:5181`: OTP `000000` + TOTP `REMOVED-OLD-DEMO-TOTP-SECRET` (DEV ONLY); the only role that can change flags / gates |
| `+201000009001` / `9002` / `9003` | Ops Admin / Finance / Support | OTP + TOTP `REMOVED-OLD-DEMO-TOTP-SECRET` / `REMOVED-OLD-DEMO-TOTP-SECRET` / enrol on first sign-in; read-only ops (not `super_admin`) |
| `+201000000001` / `0002` | Amira / Hassan | e2e fixtures, do not edit |

Dependants (Yassin, Laila, Salma, Adam, ...) have no login; they appear under their guardian ("Family").

## 4. What data exists (snapshot 21 Nov 2026) and where to click

| Data | Detail | Where to click |
|---|---|---|
| Providers (22 rows) | 14 demo LIVE: 8 Nile Care doctors (`demo_l_na_*`: Nadia paediatrics, Walid dermatology, Tamer cardiology, Rania ob-gyn, Khaled dentistry, Hossam orthopaedics, Ingy ENT, Sherif internal medicine), Dr Ola (paediatrics) and Dr Medhat (family medicine) of Delta, 2 physiotherapists (Dr Mai Hassan, Dr Hany Sobhy), 2 home nurses (Nurse Mona Adel solo, Demo Care Agency); 3 KX-DEV doctors LIVE (+3 DELISTED duplicates); **PAUSED**: Dr Samah Aref (licence expired), Dr Lamia Hafez (org flag OFF) | Search `/search`, Ops -> Providers |
| Bookings | 60 demo intents (`demo_bk_*`): 28 marketplace `mk01..mk28` (completed 11, confirmed 10, cancelled 3 refunded, no-show 1, checked-in 1, pending clinic 1, held 1 -> now EXPIRED) + 32 home / care-plan (`demo_bk_hv_*`, `demo_bk_cp1_1..10`). Current status mix of the 60: CONFIRMED 25, COMPLETED 19, CANCELLED 9, CHECKED_IN 3, NO_SHOW 2, EXPIRED 1, PENDING_CLINIC 1 | My bookings `/appointments`; Ops -> Bookings timeline |
| Deposits (60 demo intents) | NONE 21, PAID 17, RELEASED 11, REFUNDED 6, FORFEITED 2, **HOLD_FOR_REVIEW 2** (an unsafe abort 35 min old and one 46 h old), REQUIRED 1; ledger rows follow real postings (capture, PSP fee, release, refund request/settle, payout, HOLD_FOR_REVIEW, REVIEW_RELEASE, REVIEW_REFUND_REQUEST) | Checkout, booking detail; Ops -> Finance, Held deposits |
| Reviews | 40 (39 VISIBLE, 1 HIDDEN by moderation), clinic replies, provider rating aggregates | Doctor page; Ops -> Moderation |
| Vault | visit summaries, prescriptions with QR token, an uploaded ECG, share consents, follow-ups | Vault `/records` |
| Waitlist | entries (WAITING, OFFERED for Hoda, ...); accept = 5-minute hold | `/waitlist` |
| Telemedicine | `demo_ts_mk03` WAITING (Samir), `mk05` SCHEDULED (Mariam), `mk01` ENDED (Hoda) | `/telemedicine`, room `/telemedicine/:id/room` (mock video) |
| Pharmacy orders `kx_ph_demo_1..8` | 1 PENDING_PAYMENT, 2 PAID, 3 REJECTED, 4 READY, 5 DISPENSED, 6 DISPENSED, 7 REJECTED, 8 CANCELLED | `/pharmacy/orders`, Ops -> Orders |
| Lab bookings `kx_lb_demo_1..8` | 1 PENDING_PAYMENT, 2 PAID, 3 SUBMITTED, 4 COLLECTED, 5 and 6 RESULT_RELEASED, 7 REJECTED, 8 CANCELLED | `/lab/bookings`, Ops -> Orders |
| Home care | address book (encrypted; confirmed / unconfirmed / deleted), booking address snapshots (masked after 24 h), assigned / unassigned agency queue (`assignmentPending`) / en route (ETA) / arrived / completed / aborted-unsafe (not a no-show) / cancelled (refund) / no-show (forfeit); family status shares (2 active, 1 stopped) | `/account/addresses`, booking detail timeline, safety card |
| Care plans | `kx_cp_demo_1` CONFIRMED (10 visits, 4 done), `kx_cp_demo_2` REQUESTED, `kx_cp_demo_3` REJECTED | `/care-plans` |
| Nurse-lab relay | `NurseLabRelay` rows `demo_lo_nl1..4`: RESULT_RELEASED / SUBMITTED x2 / REFUSED `SAMPLE_UNMATCHED` | Ops -> Orders, Clinic Lab samples |
| Safety console | 41 alerts in the live DB (6 seeded: SOS resolved, timer expired acknowledged, unsafe abort raised / escalated with a 95 s SLO breach / resolved x2) | Ops -> Safety |
| Flags | 68 definitions in the registry (LAUNCH_LOCKED 24, MODULE 25, INTEGRATION 8, COMMERCIAL 7, AI 4); non-default values: `clinic.kiorex_listing` OFF for org `demo_t_ss`, `clinic.waitlist_autofill` OFF for org `demo_t_df`, `lab.module` OFF for `demo_lab_example`; gate evidence rows labelled **DEV-ONLY-NOT-A-REAL-GATE** (telemedicine, AI navigation, market EG, three specialty templates, plus `:GHV1/GHV2/GKN1/GKN2/GPR1/GPR2` for home visits, care plans / MAR, solo-nurse listing, physiotherapy) | Ops -> Flags |
| Payouts | `demo_po_1..3` (KIORLY_RECORDED / SENT) | Ops -> Finance |
| Message log | queued / sent / delivered / read / failed | Ops -> Messaging |

## 5. Manual test scripts

**K1. Sign in and search (Hoda).** 1) Open `http://localhost:5180`, Sign in. 2) Passport: phone `+201000001001`, code `000000`. *Expected:* back on the web app as Hoda (Arabic UI available; switch to English/RTL). 3) Search: filter by Cardiology. *Expected:* Dr Tamer Shawky with live slots; map view shows pins (offline mock tiles). 4) Open a doctor page: reviews, fees, languages, clinic.

**K2. Book with a deposit (Hoda -> Dr Nadia).** 1) Doctor page -> pick a slot -> continue. 2) Checkout: deposit amount shown, pay through the sandbox PSP (`sandbox-fake`, no real card needed). *Expected:* booking CONFIRMED, deposit PAID, a confirmation message in the message log; in Kiorly (`frontdesk1.na@`) the appointment appears with source Kiorex marketplace. 3) Try the same slot as Samir in another window before confirming. *Expected:* the second confirm fails with a slot-taken error (slot race).

**K3. Booking states (Hoda, Mahmoud, Dalia, Tarek, Heba).** 1) Hoda -> My bookings: completed (`mk01`, `mk02`), the expired hold (`mk28`), home bookings. 2) Dalia (`…1008`): the **no-show** with the deposit FORFEITED. 3) Tarek (`…1009`): **checked-in** today. 4) Heba (`…1010`): **cancelled** with the deposit REFUNDED. 5) Nourhan (`…1004`): `mk26` **pending clinic** confirmation. *Expected:* each status badge and deposit chip match section 4.

**K4. Cancel and refund (Samir `…1002`, `mk03`, 5 days ahead).** 1) My bookings -> `mk03` -> Cancel. *Expected inside the policy window:* CANCELLED + deposit refund requested then REFUNDED (watch Ops -> Finance for the REFUND ledger rows). Outside the window the cancel is allowed without refund.

**K5. Review (Hoda, `mk02`).** 1) My bookings -> completed visit -> Leave a review (stars + text). *Expected:* a verified review, rating aggregate updates, the clinic can reply in Kiorly (Kiorex tab -> reviews). Ops -> Moderation shows the HIDDEN demo review.

**K6. Pharmacy order (Nourhan).** 1) `/pharmacy` -> pick a pharmacy, add items, checkout; or open the demo order `kx_ph_demo_4` (READY). 2) In Pharmacy (../kiorly-pharmacy/DEMO_DATA.md PH5) accept / ready / dispense. *Expected:* the patient sees each state; `…_3` and `…_7` show REJECTED with a reason, `…_8` CANCELLED.

**K7. Lab booking (Omar, Mahmoud).** 1) `/lab` -> book a test, pick a slot, pay. 2) Omar's `kx_lb_demo_4` is COLLECTED: in Lab (../kiorly-lab/DEMO_DATA.md L7) release it. *Expected:* RESULT_RELEASED and the result PDF appears in the Vault. Dalia (`…1008`) and Tarek (`…1009`) already have released results.

**K8. Family and vault (Hoda, Mahmoud).** 1) Hoda -> Family: Yassin and Laila; book Dr Ola for Yassin. *Expected:* the booking belongs to the dependant (Hoda pays). 2) Vault: visit summary, prescription QR, share consents (toggle a share: Kiorly receives the consent). 3) Mahmoud (`…1005`): Adam (2y), the uploaded ECG.

**K9. Waitlist (Hoda).** 1) `/waitlist`: an entry in OFFERED state with a countdown. 2) Accept -> 5-minute hold -> confirm. *Expected:* booking confirmed in Kiorly; decline returns the entry to WAITING. A join is refused while slots are open (409 SLOTS_AVAILABLE). Delta's autofill is OFF by flag (`clinic.waitlist_autofill`, org `demo_t_df`).

**K10. Telemedicine (Samir, Mariam, Hoda).** 1) `/telemedicine`: WAITING (Samir), SCHEDULED (Mariam), ENDED (Hoda). 2) Samir joins the mock room. *Expected:* a mock video room, no media leaves the machine.

**K11. Home visit booking and timeline (Hoda).** 1) Account -> Addresses: confirmed defaults, an unconfirmed address (needs an OTP to confirm), a deleted one. 2) Book a home visit: care type Home nursing -> HOME slots for Nurse Mona. An address outside her districts (Maadi) gives `OUT_OF_COVERAGE`. 3) Pay the deposit. 4) Booking detail: timeline (assigned, en route with ETA, arrived), the **safety card** (provider photo, name, badge, emergency number, report-a-problem), the address (visible within 24 h of the visit, masked after). 5) Share status with a family member (2 active shares, 1 stopped). *Expected:* an aborted-unsafe visit is never a no-show and its deposit goes to HOLD_FOR_REVIEW (see K14).

**K12. Care plan (Nabila `…1013`, Mahmoud `…1005`).** 1) `/care-plans`: Nabila's plan `kx_cp_demo_1`: 10 visits, 4 done, 6 upcoming. 2) Mahmoud: request pending `kx_cp_demo_2`; the agency owner accepts it in Kiorly (clinic doc C9) and it turns CONFIRMED with visits.

**K13. Ops console basics (super admin).** 1) `http://localhost:5181` -> Passport: `+201000000099`, `000000`, then the TOTP for `REMOVED-OLD-DEMO-TOTP-SECRET`. *Expected:* lands on Flags (the index route). 2) Providers: the list (22 rows) and the sync from Kiorly. 3) Bookings: search `demo_bk_mk05`; the timeline events. 4) Finance: payments, refunds, ledger, payouts. 5) Moderation, Outbox (events with retries), Messaging log, Orders (pharmacy / lab), Fees, Operations (partner registrations).

**K14. Safety console and held deposits (super admin or admin).** 1) Safety: the SOS (resolved), timer expired (acknowledged), unsafe abort raised / escalated (SLO breach 95 s) / resolved. 2) Held deposits: the two held (35 min, 46 h); the older one is past the review window. Release one to the nurse, refund the other (two-person rules apply to money-path flags). 3) Home gate: the home-visit gate metric ("at least 50 providers per cluster" is NOT met by demo data, so the metric never satisfies a gate).

**K15. Flags and gates (super admin only).** 1) Flags: search `kiorex.marketplace`, switch OFF at global scope. 2) As Hoda open Search. *Expected:* 403 `FEATURE_DISABLED {key, scope}` (not hidden data). Switch it back ON. 3) Safety controls are never flags: attempting to switch one off is refused. 4) Launch-locked flags show evidence labelled `DEV-ONLY-NOT-A-REAL-GATE`; no real gate is ever recorded by a seed. 5) As `+201000009001` (ops admin): the console loads but flag changes are refused (`super_admin` only).

**K16. Patient app (Expo, `http://localhost:8081`).** 1) `npm run mobile:web`; sign in with the same phone / OTP (or `EXPO_PUBLIC_MOCK=1` for offline fixtures without the API/IdP). 2) Tabs: home, appointments, records, account; settings: sessions, family, consents, addresses, delete account. *Expected:* the same data as the web.

## 6. What each role should and should not see

| Role | Should see | Should NOT |
|---|---|---|
| Patient (any) | own bookings, own family's bookings, own vault, own orders; public provider data | other patients' bookings or records; ops console (the console shows a no-access page, API 403) |
| Guardian | dependants' bookings and vault as "act as" | an ended / expired guardian link's data as actionable |
| Home-visit patient | provider name + photo + badge before arrival, emergency number | the nurse's private phone; the address of other bookings; any address 24 h after the visit (masked) |
| Ops admin / finance / support (`ops_admin`) | all ops pages, read and act on bookings, refunds, outbox, moderation, safety | change flags or record launch-gate evidence |
| Ops super admin | everything incl. flags, gates, two-person approvals | record a *real* launch gate from a seed (never done) |
| Any role, flag OFF | 403 `FEATURE_DISABLED` with key + scope | silently missing data; flags can never switch off a safety control |

## 7. Known limitations and inconsistencies found

* Mock providers: PSP `sandbox-fake` (no real money), messaging written to the log, video `mock`, maps `mock` tiles (`VITE_MAP_PROVIDER=osm` for real tiles), AI `fake`.
* `finance` and `support` ops roles are only claims; the API distinguishes `ops_admin` from `super_admin` (see `src/common/auth.ts`). `+201000009003` has no seeded TOTP secret: an unconfirmed TOTP row already exists (left by an enrolment attempt, `confirmed_at` empty), so it still enrols on first sign-in.
* The held booking `demo_bk_mk28` is already EXPIRED (a background job); re-seed with `--reset` to see a fresh HELD one.
* Flag registry has **68** definitions (`../TEST_DATA.md` was corrected from 52 on 21 Nov 2026).
* Provider count: 14 demo LIVE (2 more demo ones are PAUSED; `../TEST_DATA.md` was corrected from "13 doctors"): includes 2 physiotherapists and 2 home-nursing providers; the three older KX-DEV doctors also appear (plus 3 DELISTED duplicates).
* Safety console shows 41 alerts, not 6: the rest come from the e2e suites.
* The patient mobile app and the Kiorly staff app (folder `kiorly`) both use Expo web ports: patient app 8081, staff app 8082.
* Staging (AWS) seeding: see `Docs/TEST_DATA.md`; Passport families / orgs are local only.

---
Verified: 2026-11-21 (`kiorex_platform` database via SELECT: 68 flag definitions, providers LIVE 17 = 14 demo + 3 KX-DEV, PAUSED 2, DELISTED 3; pharmacy order `kx_ph_demo_3` REJECTED / `SLA_EXPIRED`).

## 8. Provider go-live checklist (SMS, Email, WhatsApp, Payment)

Everything above runs on mocks (`SMS_MODE` / `EMAIL_MODE` / `WHATSAPP_MODE` / `PAYMENT_MODE` = `mock`). Going live is **only** supplying the values below; no code change when the vendor speaks the neutral payloads in [Docs/PROVIDERS.md](Docs/PROVIDERS.md) (otherwise adapt the single `apps/api/src/common/providers/<kind>.mapping.ts`).

Mock flows to rehearse first (dummy data): `POST /api/v1/dev/messaging/samples` (booking confirmation, reminder, waitlist offer, refund), book a demo deposit then `POST /api/v1/dev/payments/<id>/simulate {"outcome":"captured|failed|refund_settled"}` or use `/pay/fake-checkout/<id>`; inspect `GET /api/v1/dev/messaging/outbox`, `GET /api/v1/dev/payments`.

| Kind | Secrets Manager / SSM entry (create empty containers; humans fill) | Parameters (plain env) |
|---|---|---|
| SMS | `SMS_API_KEY`, `SMS_WEBHOOK_SECRET` | `SMS_MODE=real`, `SMS_API_URL`, `SMS_SENDER_ID` (registered alphanumeric sender), optional `SMS_TIMEOUT_MS`, `SMS_MAX_RETRIES` |
| EMAIL | `EMAIL_API_KEY`, `EMAIL_WEBHOOK_SECRET` | `EMAIL_MODE=real`, `EMAIL_API_URL`, `EMAIL_SENDER_ID` (verified from address, SPF/DKIM/DMARC done) |
| WHATSAPP | `WHATSAPP_API_KEY`, `WHATSAPP_WEBHOOK_SECRET` (also signs inbound booking webhook) | `WHATSAPP_MODE=real`, `WHATSAPP_API_URL`, `WHATSAPP_SENDER_ID` (phone number id), `WHATSAPP_TEMPLATE_MAP` (JSON, Meta-approved template names, AR + EN) |
| PAYMENT | `PAYMENT_API_KEY`, `PAYMENT_WEBHOOK_SECRET` | `PAYMENT_MODE=real`, `PAYMENT_API_URL`, plus existing `PSP_FEE_BPS`, `DEPOSIT_DEFAULT_MINOR` |
| Safety paging | none | `SAFETY_DELIVERY_MODE=real`, `SAFETY_ONCALL_PHONES` (needs SMS real) |

Steps: (1) staging first: store the secrets, set the params in the service task definition (infra: add the entries to the existing empty secret containers; the `PSP_MODE` / `MESSAGING_MODE` `TODO_NEEDS_HUMAN` tfvars become the `<KIND>_MODE` values; no tofu was run); (2) point the vendor webhooks at `https://<api>/api/v1/messaging/webhooks/{sms|email|whatsapp}` and `https://<api>/api/v1/pay/webhooks/paymob` (and `fawry`, `instapay`); (3) deploy: the API refuses to start if any real kind lacks URL / key / sender / secret (check the log for the names); (4) golden flow: book with deposit, pay, receive confirmation, reminder, waitlist offer, refund; confirm `MessageLog` rows show `mode=real`, `providerRef`, status progressing to DELIVERED; (5) rollback = set the kind back to `mock`.

## Deposit demo doctor and patient-web walkthrough (added 23 Nov 2026)
* **Dr Jihan Eissa** (`demo_l_sp_enta`, Consultation) has a 100 EGP deposit configured on the Kiorly appointment type `demo_ty_sp_cairo_consult` (`depositAmount = 100`) and in the Kiorex provider row. Book her as Hoda: Checkout shows "Due now 100 EGP", Confirm goes straight to the Kiorex Pay sandbox page (`PSP_MODE=sandbox-fake`), **Pay** returns to the appointment with the deposit PAID; cancelling inside the policy window refunds, closer to the visit it is kept (policy copy on the cancel dialog). All other doctors have no deposit because `DEPOSIT_DEFAULT_MINOR=0` (amount is NEEDS_HUMAN, KX-12). A seed reset or a Kiorly->Kiorex provider re-sync keeps the Kiorly value; re-apply the Kiorex row with `update "Provider" set "acceptsDeposit"=true, raw=jsonb_set(raw,'{provider,fees,0,depositAmount}','100') where id='demo_l_sp_enta'` if it is overwritten.
* Lab results come back only when the Lab's outbox delivers to `POST :4000/api/v1/webhooks/lab`. Lab staff steps (assign, collect, result, sign, release) are scripted in `e2e/test/05-lab.e2e.ts`.
* New patient-web screens: `/notifications` (inbox + channel preferences), Account -> Edit profile / Download my data / Sign out, review edit within 7 days.
