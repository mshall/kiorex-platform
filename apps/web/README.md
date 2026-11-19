# @kiorex/web — Kiorex patient web (port 5180)

React 18 + Vite + TypeScript + Tailwind + shadcn/ui + TanStack Query + i18next (AR default, EN) + react-router. Auth: OIDC code + PKCE against Kiorex Account (`oidc-client-ts`, client `kiorex-web`, redirect `/auth/callback`).

```bash
npm run dev -w apps/web          # http://localhost:5180, proxies /api -> http://localhost:4000
VITE_MOCK=1 npm run dev -w apps/web   # MSW mock API + fake sign-in (no backend)
npm run gen:api -w apps/web      # regenerate src/api/schema.d.ts from apps/api/openapi/kiorex-api.v1.openapi.json
npm run typecheck -w apps/web && npm run lint -w apps/web && npm test -w apps/web
```

Types come from the generated contract (`src/api/schema.d.ts`, `npm run gen:api`); `src/api/services.ts` (Phase 2/3 hooks) uses them directly and `src/api/adapters.ts` only maps them to bilingual/whole-EGP presentation models. There is **no MSW in app code paths**: MSW lives under `src/test/mocks` and is used by unit tests only.

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
