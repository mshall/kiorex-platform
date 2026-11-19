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
