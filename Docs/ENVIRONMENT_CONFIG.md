# Environment configuration, kx-test template and demo data removal (27 Nov 2026)

ADR-059 (Proposed). Canonical host list: `_docs/registry/service-url-registry.yaml` (workspace). Standard: `_docs/environments/ENVIRONMENT_CONFIGURATION_STANDARD.md`. Nothing here touches AWS, DNS or a deploy.

## 1. No host literal in runtime code

Every network host the platform used to hold as a default now lives in ONE allow-listed config file per app, resolved from an environment variable first (same defaults as before, so behaviour is unchanged when nothing is set):

| App | Config file | Variables |
|---|---|---|
| API | `apps/api/src/common/hosts.ts` | `SITE_CANONICAL_HOST`, `PUBLIC_APP_URL`, `RX_VERIFY_BASE_URL`, `WIDGET_HOST` / `WIDGET_PRODUCTION_HOST`, `WIDGET_EMBED_HOST`, `CREATIVE_CDN_HOST`, `PROVIDER_LINK_BASE_URL`, `SAMPLE_LINK_BASE_URL` |
| Patient web | `apps/web/src/lib/hosts.ts` | `VITE_KIORLY_CLINICS_URL` |
| Ops console | `apps/ops/src/lib/hosts.ts` | `VITE_SITE_CANONICAL_HOST` |
| Mobile | `apps/mobile/config/link-hosts.default.json` (read by `app.config.ts` and `src/lib/deepLink.ts`) | `APP_LINK_HOST`, `EXPO_PUBLIC_LINK_HOSTS` |

Guard: `src/common/host-literals.unit.spec.ts` scans the runtime code of api, web, ops, mobile and widget with the same rule as `validate-registry.mjs --scan` and fails on any new `kiorex.com`, `kiorly.com` or `kiorly.link` literal outside those files. Frozen event identifiers (`schemas.kiorex.com/...`) are ignored. To add a host: add it to the registry, resolve it from env in the config file.

## 2. Generated CORS, OIDC redirect and host variables

```
node scripts/emit-env-from-registry.mjs --env test|pilot|prod|all [--out <dir>] [--check] [--tool <path to validate-registry.mjs>]
```
Calls the registry tool in `--emit env` and `--emit redirects` mode and writes, per environment, into `.generated/env/<env>/` (git-ignored; never edit, never commit):

- `api.env`: `KX_ENV`, `KX_ENV_TAG`, `KX_PLANE`, `KX_REGISTRY_HASH`, `CORS_ORIGINS`, `OIDC_ISSUER`, `PUBLIC_BASE_URL`, `PUBLIC_APP_URL`, `WEB_BASE_URL`, `SITE_CANONICAL_HOST`, `WIDGET_HOST`, `WIDGET_EMBED_HOST`, `WIDGET_PRODUCTION_HOST`, `KIORLY_BASE_URL`
- `web.build.env`, `ops.build.env`: the `VITE_*` values baked into the builds
- `oidc-redirects.json`: redirect, post-logout and back-channel URIs per OIDC client (input for the identity provider config; pilot resolves to the production issuer)

`--check` regenerates in memory and exits 1 on drift (CI guard). The API consumes the output as container environment (`CORS_ORIGINS` is read by `common/security.ts`; localhost is accepted only outside production). Contains no secret.

## 3. kx-test environment template

Files: `apps/api/env/kx-test.env.template` and `apps/api/env/kx-test.containers.json`. Validate: `node scripts/validate-env-template.mjs [--generated .generated/env/test/api.env]` (also in the unit test `src/common/env-template.unit.spec.ts`).

- Values are one of: `secretref:/<product>/<env>/<purpose>` (secret by reference, resolved from the cloud secret store), `@registry` (host or identity value taken from the generated `api.env`), or a non-secret literal.
- Validator rules: every name is read by the API source; secrets only as references to the `test` path; no host literal; every `*_MODE` is `mock` and `AI_PROVIDER=fake`; `NODE_ENV=production` (production boot checks apply); no `ALLOW_INSECURE_DEFAULT_SECRETS`; `SITE_ENVIRONMENT=test` (noindex); `JOBS_ENABLED` defaults to `false` and the containers file turns it on for **exactly one** container.
- `SANDBOX_PAYMENTS_ALLOWED=true` is set for kx-test only (the mock PSP checkout); never in pilot or prod.
- Going real (any provider) is a founder decision through `INTEGRATION_MODES`; the template and its tests fail if a mode other than mock is committed.
- Small real data in kx-test: the designated real organisation is created by its owner through normal onboarding; nothing in the template seeds data. Demo or dummy rows, if loaded, are marked (next section).

## 4. Demo data marker and removal

Every row the demo seed creates is registered in the side table `"DemoMarker"` (`tableName`, `rowId`, `dataClass = DEMO`, `batch`, `createdAt`; migration `20270309090000_demo_marker`). `seed-demo.ts` marks as it goes (and `seed.ts` marks its dev-only gate evidence). Business tables are untouched.

```
npm run demo-data:remove -- --dry-run     # DEFAULT: counts per table, writes nothing
npm run demo-data:remove -- --confirm     # deletes exactly the marked rows (children first), one transaction, then their markers
npm run demo-data:remove -- --mark        # one-off backfill for a database seeded before the marker existed; follow it with --dry-run
```
Run from `kiorex-platform` (root script) or `apps/api`. `--dry-run` with `--confirm` is refused. Re-running is safe (idempotent).

Real rows are never selected: removal reads only `"DemoMarker"` (no id pattern, date, tenant or clinic). Tests: `src/common/demo-data.unit.spec.ts` (every DELETE is marker-restricted, children before parents, tagging idempotent, CLI flags) and `test/demo-data.int.spec.ts` (private database: real rows, including one with a demo-looking id, survive; dry run changes nothing; second removal is a no-op; failure rolls back).

Known limits (by design): `ConsentRecord` is an append-only audit protected by a trigger, so demo consent rows (`demo_cr_*`) remain as inert audit rows; the tool never disables a trigger. Demo providers `demo_l_*` are created by the Kiorly provider sync, not by this platform's seed, and are removed on the Kiorly side. Flag values set by the demo seed are configuration, not data; revert them through the control plane if needed.
