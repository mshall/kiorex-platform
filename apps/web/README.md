# @kiorex/web — Kiorex patient web (port 5180)

React 18 + Vite + TypeScript + Tailwind + shadcn/ui + TanStack Query + i18next (AR default, EN) + react-router. Auth: OIDC code + PKCE against Kiorex Account (`oidc-client-ts`, client `kiorex-web`, redirect `/auth/callback`).

```bash
npm run dev -w apps/web          # http://localhost:5180, proxies /api -> http://localhost:4000
VITE_MOCK=1 npm run dev -w apps/web   # MSW mock API + fake sign-in (no backend)
npm run gen:api -w apps/web      # regenerate src/api/schema.d.ts from apps/api/openapi/kiorex-api.v1.openapi.json
npm run typecheck -w apps/web && npm run lint -w apps/web && npm test -w apps/web
```

The OpenAPI declares request bodies only (no response schemas), so responses are mapped from the API wire shapes into UI view-models in `src/api/adapters.ts` / `src/api/types.ts`. When the API adds response schemas, tighten those types.

## E2E (Playwright)

Real local stack (default). Prerequisites, all running:
1. PostgreSQL on :5433 (`kiorex_platform`, `kiorex_account` migrated; see INTEGRATION.md).
2. Kiorex Account dev IdP on :4400 (`kiorex-account`: `npm run dev`) — seeded patient `+201000000001`, OTP `000000`.
3. Kiorex API on :4000 (`apps/api`).
4. For the golden booking journey: Kiorly Clinic API on :3000 with at least one LIVE provider, then sync it into Kiorex (`POST /api/v1/admin/providers/sync?full=true` as an ops admin). Without providers the golden test **skips** itself and says why.

```bash
npm run e2e -w apps/web                       # real stack
E2E_MODE=mock npm run e2e -w apps/web         # MSW mock API, no backend (UI + RTL screenshots)
```
Screenshots for RTL review land in `apps/web/e2e/screenshots/`.
