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
12 patient profiles + 4 dependants + Kiorly links + consents · 28 bookings (completed 11, confirmed 10, cancelled 3, no-show 1, held 1, pending clinic 1, checked-in 1) with events · deposits (paid, released, forfeited, refunded, awaiting) via sandbox-fake PSP, double-entry ledger (capture, PSP fee, release, refund request/settle, payout) and payouts · reviews with clinic replies (one hidden) and provider rating aggregates · vault: visit summaries, prescriptions with QR, an uploaded ECG, share consents, follow-ups · waitlist entries/offers · telemedicine sessions · message log (queued/sent/delivered/read/failed) · 8 pharmacy orders and 8 lab bookings in every state · flags: 5 explicit values incl. non-defaults.
## Where to click
Patient web: Search, My bookings, Vault, Family, Waitlist, Pharmacy/Lab orders, Telemedicine. Ops: Providers, Bookings, Payments/Ledger/Payouts, Reviews, Messages, Outbox, Partners, Flags.
## Notes
`kiorex.sponsored_listings` OFF at market EG may stay pending (money-path flag, two-person rule). Held bookings may be expired by the background job over time.
