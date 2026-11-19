# Runbook (local)

```bash
# Postgres (workspace cluster, port 5433) — see ../CLAUDE.md
PATH=/Users/postgres/bin:$PATH pg_ctl -D ../.pgdata -l ../.pgdata/server.log -o "-p 5433" start

npm install                              # repo root (npm workspaces)
cp apps/api/.env.example apps/api/.env   # never commit .env
npm run db:deploy -w apps/api            # prisma migrate deploy
npm run db:seed   -w apps/api            # flag registry (all products) + dev product keys; NO providers, NO gate evidence
npm run dev                              # api :4000 + web + ops (concurrently)
npm run dev -w apps/api                  # api only
```

Quality gates: `npm run typecheck`, `npm run lint`, `npm test` (unit + integration against `kiorex_platform_test`; migrations applied automatically),
`npm run test:flag-off -w apps/api` (flag-OFF contract), `npm run openapi:export -w apps/api` (regenerates OpenAPI + `Docs/API.md`).

Local dependencies: Kiorly API `:3000` (marketplace client `kx_dev_client`), Passport dev IdP `:4400`. Tests use an in-process fake Kiorly and a local JWKS.

## Operations

- **Provider sync** every 5 min (`JOBS_ENABLED=true`); manual: `POST /admin/providers/sync?full=true`.
- **Outbox**: `GET /admin/outbox`, replay with `POST /admin/outbox/{id}/replay`. Lag > 2 min raises `lagAlert`.
- **Reconciliation**: `POST /admin/reconciliation/psp/run`, `/bookings/run`; results in `GET /admin/reconciliation/runs`.
- **Payouts** weekly (Sun 06:00 UTC) or `POST /admin/payouts/run` (idempotent).
- **Flags**: super admin toggles via `PUT /admin/flags/{key}/values`; money-path global/market OFF needs a second approver
  (`POST /admin/flags/requests/{id}/approve`) or `emergency:true` + 24 h review. Gate evidence is a human action (see NEEDS_HUMAN STOP flags).
- Sandbox payments: `PSP_MODE=sandbox-fake` serves `/api/v1/pay/fake-checkout/{paymentId}`.

## Mock providers, dev inbox and new modules (founder rule: everything third-party is mocked until the pre-launch pass)

- `MESSAGING_MODE=mock` (default; `log` = mock): all email/WhatsApp/SMS/push go to the `MessageLog` table. Simulate a patient: `curl -XPOST :4000/api/v1/dev/messaging/inbound -H 'content-type: application/json' -d '{"channel":"WHATSAPP","from":"+201000000001","text":"hi"}'` (the phone must belong to a Kiorex profile); read what was "sent": `GET /api/v1/dev/messaging/outbox?channel=WHATSAPP`; advance delivery states: `POST /dev/messaging/delivery-tick`, ops view `GET /admin/messaging/log`. Dev routes return 404 in production or when `MESSAGING_MODE=real`. A recipient ending in `0000` simulates a bounce.
- `market.eg.live`: `npm run db:seed -w apps/api` inserts a DEV-labelled gate row so Egypt works locally (`SEED_DEV_GATES=false` skips it). Real gate evidence is recorded by a human in the super admin.
- Launch-locked verticals stay `AWAITING_GATE` (403) locally unless you record gate evidence in the super admin; Kiorly Pharmacy (:3100) and Lab (:3200) are real services: register/inspect them at `GET/POST/PUT /api/v1/admin/partners` (dev rows seeded by `npm run db:seed -w apps/api`), start the stack with `e2e/scripts/up.sh`, and see workspace INTEGRATION.md "Vertical partners". Partner 401 on submit = wrong credentials: the order stays PAID (never auto-refunded); fix the registration and `POST /admin/pharmacy/orders/{id}/resubmit` (lab: `/admin/lab/bookings/{id}/resubmit`).
- Vault uploads use `STORAGE_LOCAL_DIR` (default `.data/vault`, git-ignored). Record-share HMAC secret: `KIOREX_RECORD_SHARE_HMAC_SECRET` (must equal Kiorly's). Rx QR secret: `RX_VERIFY_HMAC_SECRET`.
- Background jobs (`JOBS_ENABLED=true`): waitlist scan 60 s, mock delivery tick 5 s (plus the existing outbox/engagement/booking jobs).
- OpenAPI: `npm run openapi:export -w apps/api` regenerates `openapi/kiorex-api.v1.openapi.json` (typed responses) and `Docs/API.md`; `test/openapi-contract.int.spec.ts` validates live responses against the committed file, so commit both together.
- Waitlist (KXM-BK-12): `POST /waitlist` for a doctor that already has open slots in the requested window returns `409 SLOTS_AVAILABLE {nextSlots, openSlotCount}` (book directly); the waitlist is only for full schedules. Autofill only offers slots freed AFTER joining and never books: accept is always the patient's own call.
- Guards: `src/no-tax-authority.unit.spec.ts` (no tax-authority reporting), `src/module-boundaries.unit.spec.ts`.

