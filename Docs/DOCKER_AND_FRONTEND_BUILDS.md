# Docker image, front-end builds and the in-process scheduler (host-agnostic)

Written 27 Nov 2026. Nothing here deploys anything or names a host: every URL is configuration. Read with `_docs/AWS_DEV_ENV_PLAN.md` section 3.1 (workspace repo).

## 1. The API image (`apps/api/Dockerfile`)

Built and booted on 27 Nov 2026 (it was PROPOSED and never built before). One image, API plus the public SEO site plus the widget host.

```bash
# from the repository root (kiorex-platform); `vendor/` (contracts 1.13.0 and pay-contract tarballs) is COPYed in the deps and runner stages, nothing is fetched from a registry
docker build -f apps/api/Dockerfile \
  --build-arg VITE_OIDC_AUTHORITY=https://<passport issuer> \
  -t kiorex-api .
```

* Build args (browser-side, baked into the patient SPA shell the image serves as fallback): `VITE_OIDC_AUTHORITY` (the exact Passport issuer; the build warns loudly when it is empty), `VITE_OIDC_CLIENT_ID` (default `kiorex-web`), `VITE_MAP_PROVIDER` (default `mock`). Patient web and ops console as stand-alone static sites are built with `scripts/build-frontends.sh` (section 2); the image only needs the SPA shell and the public site.
* Platform: the base image resolves to whatever the builder pulls; on an Apple-silicon Mac it ran as linux/amd64 under emulation (slow, works). Build on the target architecture in CI.
* Entrypoint `docker-entrypoint.mjs`: DB secret to `DATABASE_URL` (only with `DB_SECRET_ARN`), then, with `PRISMA_MIGRATE_ON_BOOT=true`, `prisma migrate deploy` with BOUNDED retries (`MIGRATE_MAX_ATTEMPTS` default 8, `MIGRATE_RETRY_BASE_MS` default 5000, linear back-off capped at 30 s). When the DB secret or the migrations still fail, the entrypoint exits 1 and never starts the server: the container restarts and the health check never turns green. A server start that fails (missing production secret, provider in real mode without credentials) now also exits 1 (`main.ts`); before this it could exit 0 or linger.
* Seeds never run on boot and cannot run in this image (`--omit=dev`, no ts-node); use `Dockerfile.seed` or CI.
* Health: `GET /api/v1/health/live` (container HEALTHCHECK), `/ready` (DB up, providers), `/_site/health` (SSR bundle present).
* Environment the image needs to boot with `NODE_ENV=production` (names only): `DATABASE_URL`, `PARTNER_LEAD_SIGNING_SECRET` (32+ characters; the API refuses to start without it) and the secrets listed in `AWS_DEV_ENV_PLAN.md` 3.1 (or `ALLOW_INSECURE_DEFAULT_SECRETS=true` for a throw-away test). The widget routes answer only on `WIDGET_HOST` (default `book.kiorex.com` in production: set it to the widget host you serve).
* Test recipe used (private resources only, removed afterwards): a `postgres:16-alpine` container on a user-defined Docker network with a scratch database `test_kx_image`, the API container on the same network with `PRISMA_MIGRATE_ON_BOOT=true`; the host Postgres on :5433 listens on localhost only, so a container cannot reach it. Verified: all migrations applied, `/health/live` 200, `/health/ready` db up, `/robots.txt` and `/sitemap.xml` 200, widget SDK and assets 200 on the widget host, SSR bundle loaded, container `healthy`; with an unreachable database and `MIGRATE_MAX_ATTEMPTS=2` the container exits 1 after two attempts.

## 2. Front-end builds: `scripts/build-frontends.sh`

The patient web and the ops console have no production fallback for the sign-in server. The build itself succeeds without `VITE_OIDC_AUTHORITY`, but the bundle throws "VITE_OIDC_AUTHORITY is not set" at sign-in. The script refuses to build without it (and refuses a non-https or local value unless `ALLOW_LOCAL_AUTHORITY=true`, for smoke tests), then checks that the built bundle contains the issuer.

```bash
VITE_OIDC_AUTHORITY=https://<passport issuer> scripts/build-frontends.sh            # web, ops, widget into dist-release/
VITE_OIDC_AUTHORITY=https://<passport issuer> scripts/build-frontends.sh web --out /tmp/out
scripts/check-release-bundle.sh dist-release/web dist-release/ops                   # dev-only content check (human release gate)
```

| App | Build-time variables | Output | Serving |
|---|---|---|---|
| Patient web (`apps/web`) | `VITE_OIDC_AUTHORITY` (required), `VITE_OIDC_CLIENT_ID` (default `kiorex-web`), `VITE_MAP_PROVIDER` and the other `VITE_MAP_*` (see `apps/web/.env.example`) | `<out>/web` | any static host, SPA fallback to `index.html`, `/api/*` proxied to the API (the app calls a relative `/api`); register `<origin>/auth/callback` on the Passport client |
| Ops console (`apps/ops`) | `VITE_OIDC_AUTHORITY` (required), `VITE_OIDC_CLIENT_ID` (default `kiorex-ops`) | `<out>/ops` | same, on its own origin |
| Widget (`apps/widget`) | none (calls `/api/v1` on the origin serving it; base path `/v1/embed/assets/` is fixed) | `<out>/widget/app`, `<out>/widget/sdk` | normally served by the API image from `WIDGET_DIST`; the folders are for a CDN copy |

`VITE_*` values are public by design (they are inside the JS). Never put a secret in one. The SEO site (`/ar/*`, `/en/*`, `/_p/*`) is served by the API image, not by these static builds.

## 3. Background jobs: in-process scheduler (no `/internal/jobs/*`)

There is no job trigger endpoint and none is planned: the tofu `scheduled_jobs` placeholder paths `/api/v1/internal/jobs/*` do not exist and should be removed from the plan. All background work (outbox poll, flags, dunning, commission statement, growth jobs, about 45 timers) runs as `setInterval` timers inside the API process, which therefore needs ONE always-on container with its CPU allocated while idle. On a platform that throttles CPU between requests (App Runner without always-allocated CPU, Cloud Run request-based billing) the timers fire late or not at all.

`src/common/job-scheduler.ts` (installed first thing in `main.ts`, never in tests) wraps `setInterval` for timers created by application code only (never libraries) and adds:

* run on start: every timer of one minute or more is also fired once, staggered, 15 s after boot (default on in `NODE_ENV=production`, off elsewhere; `JOBS_RUN_ON_START=true|false`, `JOBS_RUN_ON_START_DELAY_MS`). A restart never leaves a daily job waiting a full period. Jobs are idempotent by design.
* tick log: one `[scheduler] tick <file> (start|interval, every Ns, #n)` line per tick of a slow job; a fast poller logs its first tick, then one count per minute in the heartbeat (`JOBS_TICK_LOG=false` silences tick lines).
* late-tick warning: `LATE tick <job>: Ns since the last one` when a tick arrives more than twice its period late (throttled CPU or a stalled loop), plus a `heartbeat` line each minute with the timer count and event-loop lag. Alert on `LATE` or a missing heartbeat.
* `JOBS_ENABLED=false`: no timer is started by any service and the scheduler installs nothing (use it on a second, read-only or site-only copy; run exactly one container with jobs on, two would double-run the timers; the outbox and the limiters are idempotent but wasteful).

Not done: moving the timers behind an external trigger (EventBridge-style) would need real endpoints with an HMAC and per-job locks; decide that only if the host cannot give an always-on CPU.
