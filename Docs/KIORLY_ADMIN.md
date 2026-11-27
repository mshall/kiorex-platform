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

## Plans on the Kiorly landing page (28 Nov 2026)

View `/kiorly-plans` (nav "Plans", both editions): the subscription plans that `test.kiorly.com` (later `kiorly.com`) shows. A change here shows on the landing page within about a minute, with no release. **No second source of truth:** the Clinic owns its plans and prices, the products own theirs, and the platform only reads and relays.

| Module | Source of truth | Edited here by | Public fields |
|---|---|---|---|
| Clinic | Clinic `Plan`, `PlanEntitlement`, effective-dated `PlanPrice` per market (seeded EG list prices exist) | `super_admin`: rename, show or hide on the landing page, order, and **new price versions** (market, billing interval, per clinic or per clinician, amount, included clinicians, extra clinician amount, start time) with a **preview** of the impact on subscribers first; goes to the Clinic over the signed `MARKET_ADMIN` route (`/marketplace/v1/plans`), audited in the Clinic (`plan.price.published`, actor recorded as `actorSource KIORLY_ADMIN`) and here (`kiorly.plans.*`) | name EN/AR, limits (clinicians, branches, assistant seats), a fixed allow-list of features, active prices of the default cohort |
| Pharmacy, Lab | the editions exist in code (`LITE`, `PRO`, `CHAIN`); each product has an **empty** `PlanPrice` table and **no screen or API to set a price** (NEEDS_HUMAN LG-SUB-1, LG-SUB-6) | `super_admin`: only the **wording** (visible, name, summary, limits and features, EN and AR line for line), versioned (409 `PLAN_CONTENT_STALE` on a concurrent save), audited; stored in `SitePlanSetting` (key `content`). The setting refuses any price-like key. | name, summary, limits, features; always `priceStatus TO_BE_ANNOUNCED` |

`ops_admin` reads everything and sees no change control (the API answers 403 to any change). Bundles do not exist in code, so none are shown. Nurse and Enterprise plans are not public in the Clinic catalogue and never appear.

**Public API** `GET /api/v1/public/plans[?market=CC]` (default `EG`): no authentication, read-only, `Cache-Control: public, max-age=60, stale-while-revalidate=120`, route-scoped CORS (`PLANS_PUBLIC_ORIGINS`, falling back to `LEADS_PUBLIC_ORIGINS`: the site origin from the registry; GET only, no credentials). Contract `kiorly.public-plans.v1`: `{ market:{code,currency}|null, modules:[{ id: clinic|pharmacy|lab, status: OK|UNAVAILABLE, plans:[{ id, name{en,ar}, summary|null, limits{en[],ar[]}, features{en[],ar[]}, priceStatus: SET|TO_BE_ANNOUNCED, prices:[{interval, unit, amount, currency, includedClinicians, extraClinicianAmount}] }] }] }`. The Clinic part is read from the Clinic's own public catalogue (60 s cache, stale copy up to a day if the Clinic is down, then `UNAVAILABLE` for that module only). Entitlement keys outside the allow-list, cohort prices and internal ids never leave. A plan without an active price carries no number.

Code: `apps/api/src/site-plans/` (catalogue and validation, service, controllers, CORS), Clinic `apps/api/src/marketplace/kiorly-admin-plans.controller.ts`, ops `pages/KiorlyPlansPage.tsx`, `api/kiorlyPlans.ts`, `lib/kiorlyPlansLogic.ts`, `i18n/kiorlyPlans.json`. Tests: `apps/api/test/site-plans.int.spec.ts` and `src/site-plans/site-plans.unit.spec.ts` (public contract, roles, actor and whitelist, Clinic refusals and outage, CORS, versioned content), `apps/ops/src/__tests__/kiorly-plans.test.tsx` (screen, roles, preview before publish, EN/AR), Clinic `kiorly-admin-plans.integration.test.ts`, site `test/plans.test.ts` and the "live plans" Playwright block.

Open (founder): the seeded Clinic EG prices (Lite 499, Pro 1299 per clinician, Clinic 3499, annual variants) are the catalogue's own rows; whether they are final or only test price points (KX-12 says test) is a founder decision, and so is any Pharmacy or Lab price. Price changes are effective-dated and versioned but not maker-checker (the Clinic's existing rule for plan prices); say so if a second approver is wanted.
