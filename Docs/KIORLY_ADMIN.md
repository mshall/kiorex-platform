# Kiorly admin (`admin.<env>.kiorly.com`)

Decision (27 Nov 2026, ADR-059 service `kiorly.admin`): **the Kiorly admin is the same Ops console (`apps/ops`) served on the Kiorly admin host.** No second app, no second API, no second Passport client. What differs is the *edition*, chosen by the host the page is loaded from:

| | Kiorex super admin (`kiorex.admin`) | Kiorly admin (`kiorly.admin`) |
|---|---|---|
| Hosts (registry) | `admin.test.kiorex.com`, ... | `admin.test.kiorly.com`, ... |
| Brand | Kiorex logo, "Kiorex Ops" | Kiorly lockup (Arabic lockup in Arabic), mark on phones, tab title "Kiorly Admin", Kiorly favicon, `noindex` |
| Views | everything | provider-product views: **Market launch (Kiorly markets, `/kiorly-markets`; see below)**, providers, onboarding, partner onboarding and leads, **join requests from the Kiorly site (`/leads`, `/leads/:id`, `/leads/settings`; see `LEADS.md`)**, orders, fees, commissions and commission policy, finance, reconciliation, Kiorly Pay ops, payments connection, messaging, integrations, feature flags, operations, outbox |
| Not offered (nor routed; a direct URL redirects to `/providers`) | | bookings, moderation, liquidity, safety, held deposits, home-visit gate, market policy, growth and acquisition |
| Sign-in | Passport, client `kiorex-ops`, roles `ops_admin`, `super_admin`, `growth_admin`, `finance` | the same client and roles (an extra redirect URI is registered on `kiorex-ops`) |
| API | same-origin `/api/*` | same-origin `/api/*` (the Kiorex API) |

The edition is a presentation choice, never a permission: the API enforces roles on every call, so opening a Kiorex-only URL on the Kiorly host would be refused or redirected, not a bypass. Code: `apps/ops/src/lib/edition.ts` (resolution and the view list), `OpsLayout.tsx`, `App.tsx` (route gate), `components/KiorlyLogo.tsx`, `components/EditionHead.tsx`, assets `apps/ops/public/kiorly/` (the Kiorly marks, identical to the workspace brand kit).

## Configuration (generated from the registry, nothing typed)

`scripts/emit-env-from-registry.mjs` writes `VITE_KIORLY_ADMIN_HOSTS=<host of kiorly.admin>` into `.generated/env/<env>/ops.build.env`, next to `VITE_OIDC_AUTHORITY`. **One build serves both host families**: the edition follows `window.location.hostname`. A dedicated Kiorly-only build can set `VITE_OPS_EDITION=kiorly` instead. Registry additions (`_docs/registry/service-url-registry.yaml`): `kiorly.admin` status `planned` with that env var, and OIDC client `kiorex-ops-kiorly` (service `kiorly.admin`, `/auth/callback`, post-logout `/`); in Passport `scripts/lib/client-overrides.ts` it maps onto the existing `kiorex-ops` client, so `npm run client-overrides:emit -- --env test` registers both admin hosts on it.

## Hosting (not applied; founder-gated)

1. Serve the same `apps/ops` build (S3 + CloudFront, SPA fallback to `index.html`) on the Kiorly admin host: add `admin.<env>.kiorly.com` as an alias of the distribution that serves the Kiorex admin, or a second distribution with the same origin; ACM certificate of the `kiorly.com` environment zone covers it.
2. The console calls the API **same-origin**: the distribution on the Kiorly admin host needs the same behaviour as the Kiorex admin host, `/api/*` to the Kiorex API origin (no CORS entry is needed).
3. Register the Passport redirect URIs (`client-overrides:emit`), then deploy. Cookies stay host-only.
4. Security headers as for the Kiorex admin host (HSTS, `frame-ancestors 'none'`); the app already serves `noindex`.

## Tests

`npx vitest run src/__tests__/edition.test.tsx` (resolution, view list, layout per edition, head, route gate) and `npx playwright test -c playwright.kiorly.config.ts` in `apps/ops` (its own Vite server on port 5281, an injected session and `/api` answered by the test; the Kiorly host is `admin.kiorly.localhost`, which Chrome resolves to loopback).

## Join requests (28 Nov 2026)
Both editions show the **Join requests** inbox, detail and settings (same pages, same API `/api/v1/admin/leads`, roles `ops_admin` and `super_admin`): filters (type, status, market, mode, date range, owner, test data, duplicates, text), assignment, status changes, notes, tags, CSV export, EN/AR. Settings (picklists, required fields, test markers, notification switches) are read by ops and saved by a super admin; test leads are removed by a super admin (count, then confirm). Tests: `npx playwright test -c playwright.leads.config.ts` (both hosts) and `src/__tests__/site-leads.test.tsx`.

## Open

- Whether the Kiorly admin should later get Kiorly-specific views (for example per-organisation subscription management) that do not exist in the Kiorex console: product decision; the view list in `edition.ts` is the one place to extend.
- A role split (a Kiorly-only ops role that cannot reach Kiorex-only data) would be an API and Passport change; today the same ops roles see the same data on both hosts.


## Market launch (Kiorly markets) in the Kiorly edition (ADR-060, 27 Nov 2026)

View `/kiorly-markets` (nav "Market launch"): the Kiorly markets of the Clinic `Market` table, one per country. **The Clinic owns the data**; the Kiorex API is an audited, role-gated door over the Clinic's signed `MARKET_ADMIN` route (`/marketplace/v1/markets`), so there is one source of truth and no copy of the state here.

| | |
|---|---|
| Roles | `ops_admin` and `super_admin` read (list, details, history, pending requests). **Only `super_admin` changes** (Kiorly ops is read-only; the page says so and offers no change button). |
| Screen | Markets with state (DRAFT/LIVE/SUNSET) and operability (active/paused/disabled), data region and host cell, prerequisites (tax pack, cross-border transfer approval, host cell, commercial configuration), the **read-only Kiorex state of the same country** (`market.<cc>.live`: live, awaiting gate, off, none; changed only in Flags by a person), organisations in the market. |
| Actions | Initiate country launch (every field filled from the country: currency, timezone, locale, phone region, weekend days, languages), Go live, Pause (1 to 365 days), Disable, Enable. Each asks for a **reason** and records an approval reference and an https approval link. Details: tax pack, cross-border approval with approved sub-processors, optional second-approver rule and its pending requests, append-only history (who, when, what, reason, approval, second approver). English and Arabic (RTL). |
| API (Kiorex) | `GET /api/v1/admin/kiorly-markets`, `/country-defaults`, `/:id`, `/:id/audit`, `/:id/change-requests`; `POST` create, `/:id/launch|pause|disable|enable`, `/:id/change-requests/:rid/approve|reject`; `PUT /:id/tax-pack`, `/:id/legal-config`; `PATCH /:id/second-approver`. The actor sent to the Clinic is the token subject; only whitelisted fields are forwarded; an unreachable Clinic is `503 CLINIC_UNAVAILABLE` and nothing changes. |
| Code | `apps/api/src/kiorly-markets/`, `apps/ops/src/pages/KiorlyMarketsPage.tsx`, `src/api/kiorlyMarkets.ts`, `src/lib/kiorlyMarketsLogic.ts`, strings `src/i18n/kiorlyMarkets.json`. |
| Tests | `apps/api/test/kiorly-markets.int.spec.ts` (roles, actor, whitelist, errors, large lists), `apps/ops/src/__tests__/kiorly-markets.test.tsx` (screen, roles, errors, double click, AR/RTL, hostile text). |

An organisation belongs to its country for life (decision A of the same ADR): the platform never rewrites the market of a provider or partner, search is per market, and a booking never crosses markets.
