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
- DONE 28 Nov 2026 (ADR-062): the role split exists, see "Kiorly-only roles and role dashboards" below. Still open: row filters by organisation type and market (phase 2), only if Kiorly ops must also see finance or orders.


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
| Clinic | Clinic `Plan`, `PlanEntitlement`, effective-dated `PlanPrice` per market | `super_admin`: rename, show or hide on the landing page, order. **Prices: proposed, then approved** (see "Price proposals" below); published to the Clinic over the signed `MARKET_ADMIN` route (`/marketplace/v1/plans`), audited in the Clinic (`plan.price.published`, actor `actorSource KIORLY_ADMIN`, plus `approvalProposalId` and `proposedBy`) and here (`kiorly.plans.price_*`) | name EN/AR, limits (clinicians, branches, assistant seats), a fixed allow-list of features, active prices of the default cohort |
| Pharmacy, Lab | the product's own `PlanPrice` table (editions `LITE`, `PRO`, `CHAIN`; effective-dated, versioned per edition, market and billing interval, append-only; **empty until someone publishes**), reached through the signed, platform-level plans route of the product (Pharmacy `/marketplace/v1/plans`, Lab `/api/v1/integration/v1/plans`; credential `KIORLY_PLANS_ADMIN_CLIENT_KEY/SECRET` here, `KIOREX_PLANS_ADMIN_CLIENT_KEY/SECRET` there) | prices: proposed, then approved (below). `super_admin`: the **wording** (visible, name, summary, limits and features, EN and AR line for line), versioned (409 `PLAN_CONTENT_STALE`), audited; stored in `SitePlanSetting` (key `content`, refuses any price-like key) | name, summary, limits, features; `priceStatus SET` with the active prices only once a published price is in force, otherwise `TO_BE_ANNOUNCED` |

### Price proposals (maker-checker, 28 Nov 2026)

Single source of truth per product: **the product holds the price rows** (Clinic `PlanPrice`, Pharmacy `PlanPrice`, Lab `PlanPrice`); the platform holds only the workflow and the audit trail (`KiorlyPlanPriceProposal`, append-only: database trigger and CHECKs, same pattern as the commission rate policy). Rules, enforced in the API, repeated in the database and in the product:

- **Kiorly ops (`ops_admin`) may PROPOSE** a price version (and preview it); **a super admin may also propose**; **only a super admin decides**, and **never the proposer** (`TWO_PERSON_RULE`, 403; the proposer can withdraw). Finance and everyone else: 403.
- A proposal names product, plan (Clinic plan id, or edition `LITE`/`PRO`/`CHAIN`), market (two letters), billing interval (monthly or annual), unit (Clinic only: per clinic or per clinician), currency, amount (digits, at most two decimals), included and extra clinicians (Clinic only), an optional start time and note. A start in the past means "from the moment it is approved" (the request is kept as `requestedFrom`). One open proposal per plan, market, interval and unit.
- **Preview** (`POST /admin/kiorly-plans/prices/preview`, also run when proposing and stored on the proposal): the version it would create, whether it supersedes one, and the impact (Clinic: subscribers and monthly recurring revenue change from the existing SB-06 preview; Pharmacy and Lab: organisations on that edition and market, and the price they would pay at their next renewal). It writes nothing.
- **Advisory warnings** (never block, recorded on the proposal, shown to the approver, also shown for the catalogue as it stands): `ANNUAL_NOT_ABOVE_MONTHLY` (annual price at or below the monthly price of the same plan: the "Lite 499 per month, Pro 999 per year" kind of inconsistency; the question to answer is whether annual is per year or per month), `ANNUAL_ABOVE_TWELVE_MONTHS`, `HIGHER_PLAN_CHEAPER` / `LOWER_PLAN_DEARER`, `BIG_CHANGE` (more than 50 percent), `ZERO_AMOUNT`, `CURRENCY_CHANGED`, `FREE_EDITION_PRICED` (Lite of Pharmacy and Lab is the free edition; billing never charges it).
- **Approve** (`POST /admin/kiorly-plans/proposals/:id/approve`): the platform publishes through the product's signed route with the approval record (`proposalId`, `proposedBy`) and the approver as actor. The product refuses a publish without it or with the proposer as actor, refuses a start at or before its newest version (`PRICE_NOT_AFTER_LATEST`), ends the version in force at the new start (`validTo`), and is **idempotent per proposal** (Pharmacy, Lab) or adopted when the same Clinic version already exists, so a retry after a timeout never doubles a version. If the product is down the proposal stays pending with `lastError`. **Reject** and **withdraw** keep the row in the history.
- `POST /admin/kiorly-plans/clinic/:planId/prices` no longer publishes (409 `PROPOSAL_REQUIRED`); with `{ preview: true }` it still previews (ops can).
- Billing consequence to know before approving a Pharmacy or Lab price: once a price for the edition and market is in force, subscription renewals charge it through the billing port (`BILLING_MODE`, mock by default). With no price, renewals roll without charging.
- Not covered by this rule: the Clinic's own web console still lets a Clinic platform super admin publish a price directly (the audit row says `CLINIC_PLATFORM`). Closing it is an open founder decision.

`ops_admin` reads everything, previews and proposes prices, and cannot rename a plan, edit wording or decide a price (403). Bundles do not exist in code, so none are shown. Nurse and Enterprise plans are not public in the Clinic catalogue and never appear.

**Public API** `GET /api/v1/public/plans[?market=CC]` (default `EG`): no authentication, read-only, `Cache-Control: public, max-age=60, stale-while-revalidate=120`, route-scoped CORS (`PLANS_PUBLIC_ORIGINS`, falling back to `LEADS_PUBLIC_ORIGINS`: the site origin from the registry; GET only, no credentials). Contract `kiorly.public-plans.v1`: `{ market:{code,currency}|null, modules:[{ id: clinic|pharmacy|lab, status: OK|UNAVAILABLE, plans:[{ id, name{en,ar}, summary|null, limits{en[],ar[]}, features{en[],ar[]}, priceStatus: SET|TO_BE_ANNOUNCED, prices:[{interval, unit, amount, currency, includedClinicians, extraClinicianAmount}] }] }] }`. The Clinic part is read from the Clinic's own public catalogue (60 s cache, stale copy up to a day if the Clinic is down, then `UNAVAILABLE` for that module only). Pharmacy and Lab prices are read from the products (same cache, stale copy up to a day, never an invented number) and only those in force now for the asked market are shown (unit `PER_TENANT`, shown as per pharmacy or per lab). Entitlement keys outside the allow-list, cohort prices and internal ids never leave. A plan without an active price carries no number.

Code: `apps/api/src/site-plans/` (catalogue and validation, service, controllers, CORS), Clinic `apps/api/src/marketplace/kiorly-admin-plans.controller.ts`, ops `pages/KiorlyPlansPage.tsx`, `api/kiorlyPlans.ts`, `lib/kiorlyPlansLogic.ts`, `i18n/kiorlyPlans.json`. Tests: `apps/api/test/site-plans.int.spec.ts` and `src/site-plans/site-plans.unit.spec.ts` (public contract, roles, actor and whitelist, Clinic refusals and outage, CORS, versioned content), `apps/ops/src/__tests__/kiorly-plans.test.tsx` (screen, roles, preview before publish, EN/AR), Clinic `kiorly-admin-plans.integration.test.ts`, site `test/plans.test.ts` and the "live plans" Playwright block.

Open (founder): the seeded Clinic EG prices (Lite 499, Pro 1299 per clinician, Clinic 3499, annual variants) are NOT final and were not edited: correct them in the Plans screen (propose, a second super admin approves); the catalogue check flags the annual rows at or below the monthly price. Any Pharmacy or Lab price is a founder decision: the tables start empty and stay empty until a price is proposed and approved. Closing the Clinic web console's direct price form is open. Tests: `apps/api/test/plan-price-proposals.int.spec.ts`, `src/site-plans/price-checks.unit.spec.ts`, `product-plans.client.unit.spec.ts`, ops `kiorly-plans.test.tsx`, product `plan-prices.e2e.test.ts` (Pharmacy, Lab), Clinic `kiorly-admin-plans.integration.test.ts`, live `e2e/kx-test/tests/16-plan-prices-maker-checker.spec.ts`.

Open (founder): the seeded Clinic EG prices (Lite 499, Pro 1299 per clinician, Clinic 3499, annual variants) are the catalogue's own rows; whether they are final or only test price points (KX-12 says test) is a founder decision, and so is any Pharmacy or Lab price. Price changes are effective-dated and versioned but not maker-checker (the Clinic's existing rule for plan prices); say so if a second approver is wanted.


## Kiorly-only roles and role dashboards (28 Nov 2026, ADR-062)

**Roles.** `kiorly_ops` (read, review, onboarding actions) and `kiorly_admin` (changes within Kiorly scope). Granted only by a `super_admin` in Passport (Ops, Kiorly roles), audited, MFA mandatory like `ops_admin`; never together with Kiorex roles (the grant refuses an account that holds roles other than `patient`, the API refuses a mixed token with `403 FORBIDDEN_MIXED_ROLES`). They may NOT act as maker or checker of the commission flow, launch a Kiorly market, or approve a price (all `super_admin`).

**API: deny by default.** `apps/api/src/auth/kiorly-roles.ts` holds `KIORLY_ALLOW` (method, route, level `ops` or `admin`). For a token with a Kiorly role this list REPLACES the `@Roles` check; an unlisted route, or a route without `@Roles`, answers `403 FORBIDDEN_ROLE`. Level `admin` routes (kiorly_admin only): join-request CSV export, partner reject, go-live, pause, resume and credential rotation, enrolment codes, verification decisions (plus the plan-price routes of the plans work as listed there).

| Area | kiorly_ops | kiorly_admin |
|---|---|---|
| Providers (directory) | read | read |
| Join requests (`/admin/leads`) | read, status, owner, tags, notes | + CSV export |
| Partner leads | read, mark seen, status, notes | same |
| Partner onboarding | read, checks, review documents, verify licence, confirm fees, request changes, request approval | + reject, go-live, pause, resume, apply rotation, enrolment codes, verification decisions |
| Onboarding import batches | read (list, one, audit) only: tasks and patient lookup carry patient data and stay refused | same |
| Commission policy and rates | read | read |
| Fee statements | read | read |
| Kiorly markets | read | read |
| Plans | read, preview a price, propose and withdraw their own proposal, list proposals (never approve or reject: `super_admin`) | same |
| Orders, finance, reconciliation, payments, messaging, integrations, flags, operations, outbox, bookings, moderation, growth, audit log, partners registry | refused | refused |

**Console.** Each role lands on its own dashboard at `/home`; the menu and the route gate come from `apps/ops/src/lib/roleAccess.ts`; a refused address shows the no-access page; the Kiorex console refuses a Kiorly-only sign-in, the Kiorly console offers only the allowed views.

| Role | Dashboard (existing admin APIs only: counts and links) |
|---|---|
| `super_admin` | approvals waiting (commission policy, rates, settings, feature flags, market change requests, partner approvals; plan price proposals waiting, from `GET /admin/kiorly-plans/proposals?status=PENDING`), Passport decisions (MFA policy, sign-in limits, Kiorly roles) as links, audit highlights, system health (outbox) and links |
| `ops_admin` | moderation and complaints, safety and held deposits, outbox, provider onboarding queue, join requests |
| `finance` | commission claims by state, aging and disputes, reconciliation findings and payment matching queue, latest settlement runs, shortcuts to statements |
| `growth_admin` | growth KPIs (decisions, provider-led share, open fraud signals, widgets, landing pages) and funnel |
| `kiorly_ops` | join requests with ages (oldest first), provider onboarding queue, onboarding drafts, partner leads and verification updates, plans, markets (read only), commission policy (read only); no patient identifiers anywhere |
| `kiorly_admin` | the same plus change shortcuts |

A card whose API refuses the role (403) says it is not part of the role's work; an API error says it could not load; a list that cannot be read shows "unknown", never a made-up zero. Numbers use Western digits in Arabic.

Tests: `apps/api/test/kiorly-roles.int.spec.ts` (generated from the route table), `apps/api/test/ops-role-matrix.int.spec.ts`, `apps/ops/src/__tests__/role-dashboards.test.tsx`; live: `e2e/kx-test/tests/17-role-dashboards.spec.ts`.
