# @kiorex/ops — Kiorex ops console + super admin (port 5181)

Same stack and design system as `apps/web`; English default, Arabic available. OIDC client `kiorex-ops` (roles `ops_admin`, `super_admin` from the access token `kx_roles`). Pages: provider directory, booking timeline, outbox monitor + replay, finance (refunds/payouts/reconciliation), moderation queue, liquidity, and **Feature flags** (flags table, toggle with reason + ticket + expiry/schedule, launch-gate evidence, two-person approval queue + emergency review, audit trail + CSV export, propagation status).

```bash
npm run dev -w apps/ops            # proxies /api -> http://localhost:4000
npm run dev -w apps/ops
npm run gen:api -w apps/ops
npm run typecheck -w apps/ops && npm run lint -w apps/ops && npm test -w apps/ops
npm run e2e -w apps/ops            # real stack: Postgres :5433, dev IdP :4400 (ops admin +201000000099, OTP 000000), Kiorex API :4000
E2E_MODE=mock npm run e2e -w apps/ops
```
Real-stack E2E toggles `kiorex.reviews` OFF then restores it, so the registry is left clean.

## Console pages (Phase 2/3)
Messaging log + mock delivery simulation, fee statements (VAT is plain config; CSV export), pharmacy/lab order monitors with resubmit, operations (waitlist scan), flags incl. gate-evidence form and propagation. MSW is test-only (`src/test/mocks`). E2E: `npm run e2e -w apps/ops` against the real stack.

## Rev 2.3 home visits (KXMOP12, KXMPAY07, KXMOP06)
- `/safety` safety console: SAFETY_ALERT_RAISED feed (5 s refresh) with live 60 s delivery-SLO timers (counting / met / breached), unacknowledged-too-long marker, acknowledge / escalate / resolve with note, sweep, summary tiles, mock on-call notice.
- `/held-deposits`: deposits of unsafe-aborted visits held for review; release to provider or refund patient, reason mandatory (audited).
- `/home-gate`: home-enabled providers per launch cluster (>= 50) next to the human-recorded GHV1/GHV2 evidence; the metric never satisfies a gate.
- Flags: gate ids per flag in the catalogue plus a "Launch gates" tab (board; a human super admin records a gate for every flag that lists it).
- E2E: `npx playwright test -c playwright.home.config.ts` after the web home spec (see apps/web README). Sign-in handles the ops TOTP step (dev seed in TEST_DATA.md).
