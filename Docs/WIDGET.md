# Embeddable booking widget and JS SDK (GRW-P1-G)

Status: As-built (Wave 3, 24 Nov 2026). Decisions: ADR-044 (embed host and frame-ancestors exception), ADR-038 (every other host keeps `frame-ancestors 'none'`). The widget books through the **existing, unchanged** public slot and booking APIs; nothing in the hold, deposit, idempotency or state-machine code changed.

## What a provider pastes

```html
<script src="https://book.kiorex.com/v1/sdk.js" async></script>
<div data-kx-widget data-org="your-clinic-slug" data-locale="ar"></div>
```
Pinned variant (immutable path plus Subresource Integrity; `crossorigin="anonymous"` is required for SRI):
```html
<script src="https://book.kiorex.com/v1/<hash>/sdk.js" integrity="sha384-..." crossorigin="anonymous" async></script>
```
Plain iframe, no SDK (no resize and no `kx:booked` events):
```html
<iframe src="https://book.kiorex.com/v1/embed/your-clinic-slug?locale=ar" title="Book online" width="100%" height="640" style="border:0" loading="lazy"
  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"></iframe>
```
`GET /v1/sdk.json` publishes `{version, hash, path, integrity, bytes, gzipBytes}` (SRI value; CORS `*`). `GET /v1/sandbox?org=<slug>` is the demo page (live widget plus the three snippets) for providers.

Options (`data-*` on the element, or query parameters of the embed URL): `org` (clinic booking slug, required), `doctor` (provider id or Kiorex doctor slug: single-doctor widget), `specialty` (specialty code: specialty widget), `locale` (`ar` default for Arabic browsers, `en`), `color` (`#rrggbb`), `radius` (0 to 16), `logo` (`off` hides the clinic logo), `lt` (signed provider link token), `ref`, `height`, `sandbox`. Widget kinds: **organisation/clinic** (default: every bookable doctor of the clinic), **doctor** (`data-doctor`), **specialty** (`data-specialty`), **branch** (a branch is a Clinic clinic, so its own slug is `data-org`; one widget never mixes clinics).

## Hosts, routes, configuration
| Route (host root of the widget host) | Purpose |
|---|---|
| `GET /v1/embed/:orgSlug` | the iframe document; `Content-Security-Policy: ... frame-ancestors <exact origins of the clinic or 'none'>`, `Cache-Control: private, no-store`, `Referrer-Policy: strict-origin-when-cross-origin` |
| `GET /v1/embed/assets/:file` | hashed app files (immutable) |
| `GET /v1/embed/auth/callback` | Passport popup return page (`frame-ancestors 'none'`, no referrer) |
| `GET /v1/sdk.js`, `/v1/<hash>/sdk.js`, `/v1/sdk.json` | SDK (rolling 5 min cache; immutable versioned path, `sdkCacheSeconds` from WIDGET_POLICY), SRI manifest |
| `GET /v1/sandbox?org=` | provider demo page |
| `POST /api/v1/widget/v1/session` | short-lived token (`kxw1.`, HMAC, bound to organisation and exact origin, TTL `sessionTokenTtlSeconds`, default 900) |
| `GET /api/v1/widget/v1/config` | clinic, bookable doctors, in-clinic visit types and fees, specialties (no phone, no ids of people) |
| `GET /api/v1/widget/v1/ops/audit`, `/ops/registrations` | ops-only: refused origins, token failures, allow-list changes |

The widget host is a **role of the Kiorex API image** (same as the public site, ADR-043): the routes above are mounted at the root of the API process; `WIDGET_HOST` (default `book.kiorex.com`, NEEDS_HUMAN, same value as kiorex-account `config/domains.json` `widget`) restricts them to that Host header, so the patient site and the API host never serve a framable document. Local development leaves `WIDGET_HOST` unset: the routes answer on the API port (`http://localhost:4000`, the `widget` entry of domains.json `local`). Other configuration: `WIDGET_ENABLED=false` (hard off; flag `growth.widgets` is the soft one: OFF answers `403 FEATURE_DISABLED` for embed, SDK and session, the provider booking page keeps working), `WIDGET_DIST` (built app, `apps/widget/dist`, set in the Dockerfile), `WIDGET_SANDBOX=false` (turns the demo page off), `WIDGET_OIDC_CLIENT_ID` (`kiorex-widget`), `WEB_BASE_URL` (patient site for the confirmation deep link), `WIDGET_RATE_*` (per-minute ceilings).
`WIDGET_DEV_ORIGINS` (comma separated `http://localhost:PORT` / `http://127.0.0.1:PORT`) adds embedding origins **only when NODE_ENV and SITE_ENVIRONMENT are not production or staging** (the Playwright suite needs it because the test host cannot be https). Production ignores it.

## Origin allow-list, end to end
1. The clinic owner sets "allowed sites" in Kiorly Clinic (Growth workspace, D1). The Clinic validates them (https, exact, no wildcard, at most 10) and projects them in `PROVIDER_PROFILE_UPDATED.widgetOrigins` together with `clinic.bookingSlug`.
2. The Kiorex webhook consumer writes `WidgetRegistration` (`orgRef` = Clinic clinic id, `orgSlug`, `origins`), re-validating with the contract rule; the database CHECK (`growth_origins_valid`) makes a wildcard or http origin impossible to store. Audit `widget.registration_synced` records before and after.
3. `GET /v1/embed/:slug` sends `frame-ancestors` = exactly those origins (never `*`, never a suffix match), or `'none'`. It also refuses (403, `'none'`, audited) a request whose `Referer` origin is not in the list and a top-level navigation (`Sec-Fetch-Dest: document`).
4. The widget asks for a session token: `POST /widget/v1/session {org, parentOrigin}`; the server checks the request `Origin` is the widget host itself and `parentOrigin` is in the allow-list. The parent origin comes from the **postMessage handshake** (the SDK passes its page origin as `po`, the widget says `kx:ready` to exactly that origin, the SDK answers `kx:init`, the widget accepts it only if `event.origin === po` and `event.source === window.parent`) or, without the SDK, from `location.ancestorOrigins` / `document.referrer`; either way the server checks it against the allow-list and binds the token to it.
5. Every API call of the widget carries `X-KX-Widget`. `WidgetRequestGuard` (global guard) re-checks on **every request**: token signature and expiry, flag `growth.widgets`, registration ACTIVE and the origin still in the list (**removing an origin ends its tokens at once**), `Origin` or `Referer` equal to the widget host, a closed route table (the token cannot call anything else), provider belongs to the token's clinic, rate limits, hold limit, and forces `channel=CLINIC_LINK` with the clinic's booking slug.
Honest limit: a non-browser client can lie about `parentOrigin` and obtain a token for an allowed origin; that gives it nothing the public slot and booking APIs do not already give (booking still needs a Passport sign-in and is rate limited). The browser-enforced boundary is `frame-ancestors`.

## postMessage protocol (`src/shared/protocol.ts`, shared by SDK and widget)
Messages are `{kx:1, type, ...}`. Widget to page: `kx:ready`, `kx:resize {height}`, `kx:booked {status, bookingRef}`, `kx:error {code}`. Page to widget: `kx:init {lt?, ref?, locale?}`. Receivers check exact `event.origin` and the exact `event.source` window, validate the schema (types, lengths, character sets; extra fields are dropped) and ignore everything else; senders always pass an exact `targetOrigin`, never `*`. `kx:booked` carries a status and an opaque booking reference only: no name, phone or clinical data. The SDK re-dispatches it as a DOM `CustomEvent('kx:booked')` on the element and calls `onBooked` when mounted by script (`KiorexWidget.mount(el, {org, onBooked})`).

## Booking flow (three steps plus confirmation)
1. Doctor and visit type (skipped choices when pinned or single). 2. Day and time from `GET /api/v1/providers/:id/slots` (two weeks, "look further ahead", real-time: no extra cache). 3. Confirm: **Continue with phone number** opens Passport in a popup (Authorization Code + PKCE S256, client `kiorex-widget`; the phone number and one-time code are typed on Passport, never in the widget; the token stays in memory). First visit creates the Kiorex profile from the Passport claims (`GET /me/profile`); only a missing name is asked. The widget then creates the hold (`POST /bookings`, channel `CLINIC_LINK`, `lt` forwarded) and shows the 5-minute countdown (`role=timer`, announced at 60 s and 15 s); consent checkbox (draft wording, NEEDS_HUMAN), optional reminders, optional **anonymous analytics (unticked; the touch is sent only when ticked)**; **Confirm** calls `POST /bookings/:id/confirm` which is idempotent (repeating it after a network error returns the same result and never a second appointment). `SLOT_TAKEN` shows the alternatives from the API and re-holds; an expired hold says so. Deposit: when required, a button starts the existing hosted checkout in a new window. 4. Done: status, summary, deep link `{patient site}/appointment/<id>` which is package H's fallback page (opens the app if installed, store otherwise), `kx:booked` to the host page.
States covered: loading skeleton, empty (no doctors), no free times, slots error with retry, offline banner and recovery, origin refused, flag OFF, not found, rate limited, session expired, clinic busy, hold limit.

## Security and abuse controls
Exact-origin `frame-ancestors`; per-request origin enforcement; closed route table; no secrets, cookies or third-party scripts in the widget (CSP `script-src 'self'`, `style-src 'self'`, no inline script or style, `connect-src 'self'` + Passport); rate limits in the **shared Postgres limiter** (`RateLimitBucket`): session 30/min, config 60/min, slots 60/min per ip hash and 1200/min per organisation, hold creation 10/min, confirm and profile 30/min; slot hoarding cap `maxActiveHoldsPerPhone` (WIDGET_POLICY, default 3 active widget holds per person); refused origins audited at most once per hour per (org, origin, reason). Bot protection is these limits plus the sign-in requirement for any hold; no CAPTCHA (prohibited for agents, and a human product decision).

## Branding within safe bounds
Colour (`#rrggbb`), radius 0 to 16, logo on/off (the clinic's own published logo only, never a URL from the page). Text on the accent is white or ink, whichever reaches 4.5:1; a mid-tone fill is darkened until one does; the accent used as text on white is darkened to 4.5:1. Everything else is fixed.

## Accessibility
WCAG 2.2 A and AA checked with axe on every step (English and Arabic) in Playwright; focus moves to the step heading on each step; keyboard-only flow tested; targets at least 44 px; visible focus ring; live regions for loading and hold time; `lang` and `dir` set per locale (RTL via logical CSS properties); respects `prefers-reduced-motion`.

## Build, size, tests
`npm run build -w apps/widget` builds the app (`dist/app`) and the SDK (`dist/sdk/sdk.<hash>.js` + `manifest.json` with the SRI value) and enforces the budget (`check-budget.mjs`: SDK <= 10 KB gzip, measured 1.5 KB; app <= 40 KB gzip, measured about 17 KB). Tests: API unit (origins, token, brand, snippets, policy) and `test/widget.int.spec.ts` (CSP per organisation, forbidden origin, revocation, route table, rate limits, hold limit, CLINIC_LINK forced, idempotent confirm, **12 widgets racing for one slot: exactly one wins, the rest get SLOT_TAKEN with alternatives**, SDK SRI bytes); widget vitest (protocol, built SDK bundle against jsdom, strings); Playwright `npm run e2e -w apps/widget` (own API on :4393 with a throw-away database, Passport stand-in :4394, provider sites :4392): end to end booking from another origin, Arabic RTL, 360 px, blocked non-allow-listed origin, plain iframe, forged postMessages, slot taken, empty, error and offline states, axe.

## Coordination
Kiorly Clinic (D1) already prints these snippets from `KIOREX_WIDGET_BASE_URL` (default `https://book.kiorex.com`): `{base}/v1/sdk.js`, `{base}/v1/embed/{slug}?locale=`. They match this implementation, so no Clinic code changed. Local: set `KIOREX_WIDGET_BASE_URL=http://localhost:4000`. The Clinic projection gained `clinic.bookingSlug` (one line) so Kiorex can resolve the slug.
Package C: the widget sends `lt` in the `POST /bookings` body and the guard forces `channel=CLINIC_LINK` and `bookingPageSlug`; recording the decision `PROVIDER_LED` from `lt` is C's change in `booking.service.ts`.

## Not done / NEEDS_HUMAN
Final widget host name (`book.kiorex.com`) and its CloudFront/DNS (cdn-edge module not touched: no deploy allowed); real Passport `kiorex-widget` client registration in staging and production; consent wording AR/EN (draft marker shown); counsel review of the analytics checkbox; store URLs for the confirmation link (package H); SDK version retention for old SRI-pinned `/v1/<hash>/sdk.js` paths (only the current build is in the image: keep previous builds in the CDN origin before the second release).
