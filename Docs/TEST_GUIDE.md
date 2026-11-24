# Kiorex platform test guide (DEV ONLY)

> **DEV ONLY / synthetic.** All names, phones, e-mails, passwords, OTPs and TOTP seeds below are fake values for the local stack; they are refused when `NODE_ENV=production` and the sign-in quick-pick ("Test users (dev only)") is not in production builds. Providers are mocked (dev inbox / logs, PSP `sandbox-fake`, video `mock`). No tax-authority integration.
> This guide is the repo's slice of the workspace guide `TEST_GUIDE.md` (parent folder `kiorex-v2/`, not part of this repository). Facts verified against the seeds and dev databases on 23 Nov 2026.

## Run the stack and seed it

```bash
# from the workspace root (kiorex-v2/): Postgres :5433 + the five APIs (Passport :4400, Kiorly :3010, Kiorex :4000, Pharmacy :3100, Lab :3200)
e2e/scripts/up.sh --build --seed      # first time; later just e2e/scripts/up.sh (stop: e2e/scripts/down.sh)
scripts/seed-all.sh                   # idempotent demo data in dependency order (--reset re-creates demo rows only)
```
One service only: `e2e/scripts/up.sh --restart --only=passport|kiorly|kiorex|pharmacy|lab > /tmp/up.log 2>&1`. Never touch ports 3000 / 5173 / 5175. Tests you run change data (a cancel stays cancelled): re-seed for the starting state.

```bash
cd kiorex-platform
npm run dev -w apps/web      # patient web :5180
npm run dev -w apps/ops      # ops console :5181
npm run mobile:web           # patient Expo app :8081
cd apps/api && npm run db:seed:demo   # idempotent; -- --reset removes only demo rows (needs the Kiorly seed + provider sync first, scripts/seed-all.sh does both)
```

### Every local URL

| Port | What | URL |
|---|---|---|
| 4400 | Kiorex Passport (dev IdP, sign-in, account pages, dev inbox) | http://localhost:4400/account · http://localhost:4400/dev/inbox |
| 4000 | Kiorex API | http://localhost:4000/api/v1 |
| 5180 | Kiorex patient web | http://localhost:5180 |
| 5181 | Ops console / super admin | http://localhost:5181 |
| 8081 | Patient Expo app (web build) | http://localhost:8081 |
| 3010 / 5174 | Kiorly Clinic API / web | http://localhost:5174/login |
| 3100 / 5192 | Kiorly Pharmacy API / web | http://localhost:5192/login |
| 3200 / 5193 | Kiorly Lab API / web | http://localhost:5193/login |
| 8082 | Kiorly staff app (Expo web; use phone width) | http://localhost:8082/sign-in |
| 5433 | Postgres (`postgres` / `postgres`, DEV ONLY) | |

Dev-only secrets: Passport OTP for every seeded phone **`000000`**; staff password **`Demo@12345`** (older Clinic accounts `admin@kiorly.com`, `superadmin@kiorly.com`, `admin@drahmedshall.com`: **`demo`**); Lab dev-login has no password; Postgres `postgres` / `postgres`.

## Quick-pick panels

The patient web (:5180) and the ops console (:5181) have no login form of their own: Sign in redirects to Kiorex Passport (:4400), whose page carries the **Test users (dev only)** panel (patients grouped, ops with the current TOTP code and seed). The patient app (`apps/mobile`, `/sign-in`) has its own panel that passes the phone to Passport as `login_hint`. Hide with `EXPO_PUBLIC_DEV_TEST_USERS=false` (app) or `KX_DEV_TEST_USERS=false` (Passport). `npm run check:dev-test-users` in `apps/mobile` asserts the panel and phones are absent from a production export.

## Test users: 3.1 Passport phones (OTP `000000`)

| Phone | Name | Use it for |
|---|---|---|
| `+201000001001` | Hoda Mahmoud / هدى محمود | richest history: completed visits, expired hold, 2 dependants (Yassin 8y, Laila 4y), 4 addresses, home bookings with Mona, an OFFERED waitlist entry, telemedicine ENDED, pharmacy order PENDING_PAYMENT |
| `+201000001002` | Samir Ali Nassar | co-guardian of Yassin; `mk03` CONFIRMED with deposit PAID (cancel/refund test); telemedicine WAITING; pharmacy PAID |
| `+201000001003` | Karim Mostafa | guardian of Salma (15y, court order); pharmacy REJECTED; physio |
| `+201000001004` | Nourhan Fathy / نورهان فتحي | pharmacy order `kx_ph_demo_4` READY; `mk26` pending clinic; lab `kx_lb_demo_1` PENDING_PAYMENT |
| `+201000001005` | Mahmoud El-Sayed / محمود السيد | cardiology, guardian of Adam (2y), uploaded ECG, 10-session physio series, care-plan request |
| `+201000001006` | Mariam Adel | `mk05` CONFIRMED (reschedule), telemedicine SCHEDULED, pharmacy DISPENSED, lab SUBMITTED |
| `+201000001007` | Omar Hegazy | lab `kx_lb_demo_4` COLLECTED (release it in Lab), pharmacy REJECTED |
| `+201000001008` | Dalia Ibrahim | **no-show with forfeited deposit** (`mk06`), lab result released, pharmacy CANCELLED |
| `+201000001009` | Tarek Zaki | **checked-in** today (`mk09`), lab result released; Passport link request `pending_review` |
| `+201000001010` | Heba Salah | cancelled and refunded (`mk12`); pending Nile Care nurse invitation |
| `+201000001011` / `…1012` / `…1013` | Youssef Ramadan / Rana Khaled / Nabila Hamdy | dentistry + lab cancelled / refunded, agency client / home-care plan `kx_cp_demo_1` (10 visits, 4 done) |
| `+201000000001` / `…0002` | Amira (ar) / Hassan (en) | plain patients |
| `+201000002001` .. `…2010` | Ahmed Fawzy (Nile Care owner), Sara, Dr Amr Salem, Mostafa Reda (pharmacist), Dina Wagdy (lab tech), Dr Nadia Fouad, Demo Pharmacy Owner, Omar Cashier, Dr Salma (lab signatory), Demo Lab Owner | provider-side people with a Passport identity (organisations, invitations, Sign in with Kiorex Passport on Kiorly) |
| `+201000003001` .. `…3011` | Mona (solo nurse), Agency Owner, Dina Dispatcher, Heba / Salma / Aya / Nadine / Rawan / Yara, Dr Mai Hassan (physio), Noha (pending invite) | Nurse edition personas; `…3004` Heba is the verified agency nurse |

### 3.2 Ops console (Passport phone + `000000` + authenticator code)

| Phone | Role | TOTP seed (Base32, DEV ONLY) |
|---|---|---|
| `+201000000099` | Ops **super admin** (flags, gates, two-person approvals) | `REMOVED-OLD-DEMO-TOTP-SECRET` |
| `+201000009001` | Ops admin (everything except changing flags) | `REMOVED-OLD-DEMO-TOTP-SECRET` |
| `+201000009002` | Ops finance (role claim only; API treats it as `ops_admin`) | `REMOVED-OLD-DEMO-TOTP-SECRET` |
| `+201000009003` | Ops support (claim only) | none seeded: it enrols a new authenticator on first sign-in (the page shows the setup key) |

The Passport dev panel computes the current code for you (the dev IdP knows the seed). To do it by hand: any authenticator app with the seed, or `node -e "console.log(require('otplib').generateSync({secret:'REMOVED-OLD-DEMO-TOTP-SECRET',strategy:'totp'}))"` from `kiorex-account/`. A code can be used once: if "wrong code" appears right after a quick sign-in, wait for the next 30-second code.

## Flows

### 4.2 Kiorex patient web (K1-K12)

Patient web :5180; chips on Passport. Routes: `/search`, `/doctors/:id`, `/appointments`, `/appointments/:id`, `/records`, `/pharmacy`, `/pharmacy/orders`, `/lab`, `/lab/bookings`, `/telemedicine`, `/waitlist`, `/care-plans`, `/account`, `/account/addresses`.

1. **Search and book with a deposit (Hoda to Dr Nadia).** Chip Hoda. Search (filter Cardiology: Dr Tamer Shawky has live slots; the map shows mock pins). Open Dr Nadia Fouad, pick a slot, continue to checkout, pay the deposit on the sandbox PSP (`sandbox-fake`, no card). *Expected:* booking CONFIRMED and deposit PAID, a confirmation in Ops -> Messaging and the dev inbox, and in Kiorly (`frontdesk1.na@`) an appointment with source Kiorex marketplace. A second patient taking the same slot before you confirm gets a slot-taken error.
2. **Pay a deposit later.** Open a booking whose deposit is not paid and press "Pay deposit"; you go to the sandbox checkout and return to `/appointments/:id` with the chip PAID.
3. **Booking states.** Hoda `/appointments`: completed (`mk01`, `mk02`), expired hold (`mk28`). Dalia: no-show, deposit FORFEITED. Tarek: checked-in today. Heba Salah: cancelled, deposit REFUNDED. Nourhan: `mk26` pending clinic confirmation.
4. **Reschedule.** Chip Mariam (`+201000001006`), `/appointments`, open `mk05` (confirmed, future), press **Reschedule**, choose another slot. *Expected:* toast "rescheduled" and the new time; the clinic sees it in Kiorly. Doing it again past the free limit shows the "reached the number of free reschedules" message; inside the policy window closing shows "window closed".
5. **Cancel and refund.** Chip Samir (`+201000001002`), open `mk03` (deposit PAID, 5 days ahead), **Cancel appointment**, confirm. *Expected:* CANCELLED and the deposit refund requested then REFUNDED (Ops -> Finance shows the REFUND ledger rows). Outside the free window the cancel works but the deposit is kept.
6. **Review.** Chip Hoda, open the completed visit `mk02`, leave stars and text. *Expected:* a verified review; the rating aggregate updates; the clinic can reply in Kiorly (Kiorex tab); Ops -> Moderation shows the HIDDEN demo review.
7. **Records and family.** Chip Hoda, `/records`: visit summary, prescription QR, share consents (toggle a share: Kiorly receives it). Family: book Dr Ola for Yassin (Hoda pays). Mahmoud: Adam (2y) and the uploaded ECG.
8. **Waitlist.** Chip Hoda, `/waitlist`: an OFFERED entry with a countdown. Accept (5-minute hold), confirm: booking confirmed in Kiorly; decline returns it to WAITING. Joining while slots are open is refused (409 `SLOTS_AVAILABLE`). Delta's autofill is OFF by flag.
9. **Telemedicine.** Chip Samir (WAITING), Mariam (SCHEDULED), Hoda (ENDED) at `/telemedicine`; Samir joins the mock room (dev `VIDEO_MODE=mock`). *Expected:* a mock video room, no media leaves the machine. Real video visits are Clinic-owned peer-to-peer calls: a booking that carries a `telehealth` block shows "Join video visit" which opens the Clinic `/v/<token>` page (needs the Clinic telehealth build).
10. **Pharmacy order and delivery.** Chip Nourhan, `/pharmacy/orders`: `kx_ph_demo_4` READY. Place a new order: pick a pharmacy, add items, choose **Pickup** or **Delivery** (address needed; delivery fee shown when the pharmacy enables it), pay. In Pharmacy (:5192, `pharmacist@`) accept, mark Ready, for delivery orders **Out for delivery**, then dispense. *Expected:* the patient sees each state, including OUT_FOR_DELIVERY; seeded orders: `_1` PENDING_PAYMENT, `_2` PAID, `_3` / `_7` REJECTED, `_5` / `_6` DISPENSED, `_8` CANCELLED.
11. **Lab booking and result.** Chip Omar (`+201000001007`), `/lab`: book a test, pick a slot, pay. His seeded `kx_lb_demo_4` is COLLECTED: in Lab, `tech@demo-lab.test` then `signatory@demo-lab.test` validate and release. *Expected:* RESULT_RELEASED and the PDF in `/records` (Vault). Dalia and Tarek already have released results; `kx_lb_demo_7` is REJECTED, `_8` CANCELLED.
12. **Home visit.** Chip Hoda, `/account/addresses` (confirmed defaults, an unconfirmed one needing an OTP, a deleted one), then book a home visit with Nurse Mona: an address outside her districts (Maadi) gives `OUT_OF_COVERAGE`. Pay the deposit; the booking shows the timeline (assigned, en route with ETA, arrived), the safety card (photo, badge, emergency number, report a problem), and the address only within 24 hours of the visit.
13. **Care plan.** Chip Nabila (`+201000001013`), `/care-plans`: 10 visits, 4 done. Mahmoud's request `kx_cp_demo_2` turns CONFIRMED when the agency owner accepts it in Kiorly (workspace guide 4.6 step 6).
14. **Arabic and RTL.** Switch language in the header (or open Passport with `?lang=ar`). *Expected:* `<html dir="rtl" lang="ar">`, mirrored layout, Arabic digits setting, all labels translated; names such as هدى محمود display correctly; switch back to English.

### 4.3 Patient app (Expo)

1. `cd kiorex-platform && npm run mobile:web` (http://localhost:8081), or `EXPO_PUBLIC_MOCK=1` for offline fixtures. On `/sign-in` tap a chip, for example **Mariam Adel**. *Expected:* the browser opens Passport, the phone and code are filled automatically and you return signed in. Tabs: home, appointments, records, account; settings: sessions, family, consents, addresses, delete account. On a device use `npm run ios` / `android` (the dev client opens Passport in the system browser the same way).
2. Sign out from Account: confirmed sheet, app and Passport sessions end.

### 4.4 Ops console, flags and gates (K13-K15)

1. Open http://localhost:5181, on Passport tap **Ops super admin** (`+201000000099`) and then **Fill current code and verify**. *Expected:* lands on Flags. Other pages: Providers (sync from Kiorly), Bookings (search `demo_bk_mk05` and read the timeline), Finance, Moderation, Outbox, Messaging, Orders, Fees, Operations, Onboarding.
2. **Flag OFF gives 403.** Flags: search `kiorex.marketplace`, switch OFF at global scope. As Hoda open Search. *Expected:* 403 `FEATURE_DISABLED {key, scope}` shown as a disabled notice (data not hidden). Switch it back ON. Safety controls are never flags: switching one off is refused. Launch-locked flags show evidence labelled `DEV-ONLY-NOT-A-REAL-GATE`; no seed records a real gate.
3. **Role limits.** Sign in as Ops admin (`+201000009001`): console loads, flag changes are refused (super admin only). A patient (Hoda) opening :5181 sees the no-access page.
4. **Safety and held deposits.** Safety: SOS (resolved), timer expired (acknowledged), unsafe abort raised, escalated (SLO breach 95 s), resolved. Held deposits: two rows (35 min, 46 h); release one to the nurse, refund the other. The home-visit gate metric stays unmet with demo data.
5. **Organisation onboarding import (ops, two-person rule).** Create the 100 % fake sample files once: `cd kiorex-platform/apps/api && npx tsx -e "import {buildSample} from './src/onboarding-import/sample/sample-data'; import {mkdirSync,writeFileSync} from 'node:fs'; const s=buildSample(); mkdirSync('/tmp/onb-sample',{recursive:true}); writeFileSync('/tmp/onb-sample/clinicpro_dump.sql',s.sql); for (const f of s.files) writeFileSync('/tmp/onb-sample/'+f.name,f.bytes)"`. Sign in as **Ops admin** (`+201000009001`), open **Onboarding imports**, create a batch, upload the files. *Expected:* each file is sniffed and scanned (the SQL is parsed, never run), tables are mapped to patients / appointments / visits / billing / documents, and ambiguous items become tasks (confirm mapping, confirm file match, duplicate, orphan file); resolve the blockers (ignoring needs a reason), check the dry-run counts and report hash, then **Request commit**. Switch to **Ops super admin**: Approve (it must be a different person than the requester; the hash must match), Commit. *Expected:* status COMMITTED with per-entity counts (target `mock` by default, nothing leaves the platform); the super admin can Roll back with a reason. Switch the console to Arabic to see RTL.
6. **Org flag for the staff app.** Switch `mobile_staff_app` OFF at org scope for Nile Care: the staff-app bootstrap reports `FLAG_OFF` (workspace guide 4.8 step 4).

Deeper script list and role matrix: `DEMO_DATA.md` (K1-K16) and `Docs/TEST_DATA.md`; org onboarding import design: `Docs/ORG_ONBOARDING_IMPORT.md`.

## Booking widget and SDK (GRW-P1-G)
- API unit: `npm run test:unit -w apps/api -- --testPathPatterns src/widget`. API integration (builds `apps/widget` first when stale): `NODE_OPTIONS=--experimental-vm-modules npx jest --selectProjects integration --runInBand --testPathPatterns test/widget.int` in `apps/api` (CSP per organisation, forbidden origin, revocation, rate limits, hold limit, 12 widgets racing for one slot, SRI bytes).
- Widget unit: `npm test -w apps/widget` (postMessage protocol, the built SDK bundle in jsdom, strings). Size budget: `npm run check:budget -w apps/widget` (SDK <= 10 KB gzip, app <= 40 KB gzip).
- Browser: `npm run e2e -w apps/widget` starts its own API on :4393 (own database, dropped on exit), a Passport stand-in on :4394 and provider test sites on :4392 (`http://localhost:4392` is allow-listed, `http://127.0.0.1:4392` is not): end to end booking from another origin, Arabic RTL, 360 px, blocked origin, forged postMessages, failure states, axe. Use `--project=desktop` or `--project=mobile` for one profile.
- Manual: `http://localhost:4000/v1/sandbox?org=<clinic booking slug>` on the local dev stack (the Passport popup needs the `kiorex-widget` client from `kiorex-account/config/idp.json`: restart Passport once to load it).
