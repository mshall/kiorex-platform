# @kiorex/web — Kiorex patient web (port 5180)

React 19 + Vite 8 + TypeScript 6 + Tailwind 4 + shadcn/ui + TanStack Query + i18next (AR default, EN) + react-router. Auth: OIDC code + PKCE against Kiorex Passport (`oidc-client-ts`, client `kiorex-web`, redirect `/auth/callback`).

```bash
npm run dev -w apps/web          # http://localhost:5180, proxies /api -> http://localhost:4000
VITE_MOCK=1 npm run dev -w apps/web   # MSW mock API + fake sign-in (no backend)
npm run gen:api -w apps/web      # regenerate src/api/schema.d.ts from apps/api/openapi/kiorex-api.v1.openapi.json
npm run typecheck -w apps/web && npm run lint -w apps/web && npm test -w apps/web
```

Types come from the generated contract (`src/api/schema.d.ts`, `npm run gen:api`); `src/api/services.ts` (Phase 2/3 hooks) uses them directly and `src/api/adapters.ts` only maps them to bilingual/whole-EGP presentation models. There is **no MSW in app code paths**: MSW lives under `src/test/mocks` and is used by unit tests only.

## Public site (SSR, GRW-P1-E)
Public pages under `/{ar,en}/{cc}/...` are rendered by the Kiorex API (role `all`) from `src/entry-server.tsx` and hydrated by `src/entry-client.tsx`; the SPA (`dist/`) is unchanged and `noindex`. `npm run build:public` builds the client and the SSR bundle into `dist-public/`; `npm run dev:public` watches both; the dev server proxies `/{ar,en}/{cc}/*`, `/_p`, robots and sitemaps to the API. Templates live in `src/public/templates` (registry: `src/public/registry.ts`). Details, config and tests: [`Docs/SEO.md`](../../Docs/SEO.md).

## Features (Phase 2/3)
Waitlist (join from the no-slot state; 409 `SLOTS_AVAILABLE` shows "book directly"; offers inbox), records vault (list/view/download/delete/upload, per-scope sharing consent, prescriptions with QR, follow-ups, read-only banner), pharmacy (search, cart, delivery, Kiorex Pay sandbox checkout, order tracking, cancel, rejected/refunded states), lab bookings (home-collection slots, result delivered into the vault), telemedicine (providers, sessions, mock video room), services hub + WhatsApp info, market selector (`market.<cc>.live`), booking channel badges, sponsored label, whitelisted analytics (`POST /analytics/events`). Launch-locked flags render "awaiting approval"; test/sandbox providers are called out via `MockNotice`. Set `VITE_WHATSAPP_NUMBER` once the real number exists (NEEDS_HUMAN); consent-centre and prescription copy needs legal/clinical review before launch.

## E2E (Playwright, real stack only)
Prerequisites running: Postgres :5433, Passport :4400, Kiorly :3010, Kiorex API :4000 (providers synced). OTP `000000`; the first test signs in through the real OIDC UI and caches the session in `e2e/.auth/` (git-ignored).
```bash
npm run e2e -w apps/web                       # golden journey, vault, waitlist, new screens (AR/RTL, dark), analytics
# Pharmacy / lab / telemedicine are launch-locked on the shared dev DB. Isolated stack with TEST-FIXTURE gates and API :4001 (real Kiorly Pharmacy/Lab partners must be running):
pkill -f "vite"                               # :5180 must be free
node apps/web/e2e/verticals/stack.mjs up && (cd apps/web && npx playwright test -c playwright.verticals.config.ts); node apps/web/e2e/verticals/stack.mjs down
```

### Running the default suite against a PRIVATE stack (27 Nov 2026)
`npx playwright test` (fixed port 5180) used to assume the shared dev stack (Passport :4400, API :4000, database `kiorex_account`). Everything is now parameterised, so a run never has to touch the shared stack: start a private stack (`e2e/scripts/reg-stack.sh up`: Passport :4810, Kiorex :4813), then
```bash
KIOREX_API_URL=http://localhost:4813 VITE_OIDC_AUTHORITY=http://localhost:4810 npx vite --port 5180 --strictPort &      # patient web (5180 must be free)
(cd ../ops && KIOREX_API_URL=http://localhost:4813 VITE_OIDC_AUTHORITY=http://localhost:4810 npx vite --port 5181 --strictPort &)   # ops web (the fixtures sign in as ops)
KIOREX_API_URL=http://localhost:4813 PW_PASSPORT_URL=http://localhost:4810 PW_ACCOUNT_DB=reg_kiorex_account SHOTS_DIR=/tmp/pw-shots npx playwright test
```
`PW_PASSPORT_URL` and `PW_ACCOUNT_DB` replace the hard-coded `:4400` / `kiorex_account` (OTP counters are cleared in that database only); `SHOTS_DIR` sends the screenshots somewhere other than the tracked `_docs/test-flow/**` (a run used to rewrite 71 tracked PNGs). The default run excludes the specs that have their own config, server and port (`deep-links`, `home`, `verticals`, `ui-review`, loyalty, preference centre, sponsored label, real-stack: see `testIgnore`); they are run with their `playwright.*.config.ts`. Two vault specs skip with a reason when the seed patient has no LINKED Kiorly record (the clone of an aged dev database may have only CONFLICT_REVIEW links).

## Rev 2.3 home visits / nurse / physiotherapy (KXMDS01, KXMHV01-10, KXMPR01, KXMPAY07)
Wired to the real API (clients regenerated: `npm run gen:api -w apps/web`, 184 ops). AR/RTL, dark mode, loading / empty / error / awaiting-gate states everywhere.
- Care-type tabs (Doctors · Physiotherapy · Home nursing) on home, landing and search (`GET /care-types`; a category awaiting its gate shows locked, never hidden).
- Address book `/account/addresses` (add / edit / delete / confirm; doorstep lines masked until revealed). Home search by district (`/search?careType=…&serviceLocation=HOME&district=…`; the API needs a district) with the OUT_OF_COVERAGE message; profile "At home" mode with address picker, surcharge note and coverage check.
- Checkout shows visit address (masked), fee + home surcharge, deposit. Appointment page: home sub-states (agency assignment pending, assigned nurse, en route + ETA, arrived, aborted-unsafe with deposit under review), safety card (provider photo/name/badge, 123, report a problem), family share by WhatsApp link (mock messaging, attestation + VISIT_STATUS_SHARING consent) and the public family page `/visit-status/:token` (status only).
- Care plans `/care-plans` (P3 draft): shows the awaiting-gate state while GKN1 is unrecorded. `kiorex.home_visits` OFF/awaiting shows the unavailable state; existing bookings stay readable.
- Specialty codes map to AR/EN labels (`src/lib/specialties.ts`, test fails on unmapped codes).
- Known API contract defect: the generated schema merges same-named DTOs (`AddressBody`, `ShareBody`, `ReviewBody`); three call sites use local body types (see `api/services.ts`, `api/hooks.ts`).

### Home-visit E2E (isolated stack, DEV-ONLY gate rows GHV1/GHV2/GPR1; GKN1/GKN2 unrecorded)
```bash
node e2e/home/stack.mjs up                       # throwaway DB kiorex_e2e_home, API :4001, the API's HMAC-verifying fake Kiorly
npx playwright test -c playwright.home.config.ts # uses the web dev server on :5180, /api re-pointed to :4001 by the spec
(cd ../ops && npx playwright test -c playwright.home.config.ts)   # ops console journeys, run after the web spec
node e2e/home/stack.mjs down
```
