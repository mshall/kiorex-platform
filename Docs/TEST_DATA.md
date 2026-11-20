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
