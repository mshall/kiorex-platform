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
Phone OTP `000000` (see Passport). Patients `+201000001001 … +201000001012` (Hoda `…1001` has two dependants and the richest history). Ops super admin `+201000000099` + TOTP `REMOVED-OLD-DEMO-TOTP-SECRET`; ops admin `+201000009001`, finance `+201000009002`, support `+201000009003`.
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
