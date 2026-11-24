# Growth integrations and advanced acquisition analytics (GRW-P2-F, as built)

Status: built 24 Nov 2026 (W6, lane A4). Nothing pushed or deployed. Every integration ships in **mock** mode; `real` mode is config-only and fails closed.

## What exists

| Piece | Where |
|---|---|
| Port, registry data, PHI gate | `apps/api/src/growth/integrations/{port.ts, assert-ad-safe.ts}` |
| Orchestration (config, flag, breaker, rate budget, retry, idempotent store, run history, event) | `integrations/integration.service.ts`, `circuit.ts` |
| Jobs | `integrations/jobs/pull.job.ts` (hourly tick, once a day per integration, no mock pulls on a production API), `push-conversions.job.ts` (default disabled, sends nothing) |
| Mock adapters (deterministic synthetic series for all ten kinds) | `integrations/mock/mock.adapter.ts` (one factory instead of ten files) |
| Real adapters (HTTP, config only, ADR-028) | `apps/api/src/platform/adapters/growth/*.adapter.ts`, façade `src/platform/platform-public.ts` |
| Admin API | `integrations/integrations-admin.controller.ts` |
| Analytics | `src/growth/analytics/{external-metrics.service.ts, channel-performance.service.ts, formulas.ts}` |
| Ops | `GrowthIntegrationsPage` (panel `IntegrationsPanel`), `GrowthChannelsPage` (panel `ChannelPerformancePanel`), namespace `growth.integrations2.*` and `growth.perf.*` in `src/i18n/growth.integrations.json` |
| Tests | unit: `assert-ad-safe`, `circuit`, `integrations-contract` (every mock, every real adapter fail-closed and recorded-fixture parsing), `no-health-targeting`, `channel-formulas`; integration `test/growth-integrations.int.spec.ts`; ops vitest `growth-integrations.test.tsx`; Playwright `apps/ops/e2e/growth-integrations.spec.ts` |

## API (ops session, `Roles` read for every Growth role; pulls need super admin)

`GET /admin/growth/integration-status`, `GET /admin/growth/integration-runs?kind=`, `POST /admin/growth/integrations/:kind/test`, `POST /admin/growth/integrations/:kind/run` (mock: direct; real: `{requestId}` of a request by **another** super admin), `POST /admin/growth/integrations/:kind/run-requests`, `GET /admin/growth/channel-performance?from=&to=` (finance roles also get ROAS, MER and revenue).

Configuration is the existing `INTEGRATION` config kind (maker-checker): per kind `{mode, secretRef, accountLabel, pullSchedule, rateBudgetPerHour, retentionDays}`. `secretRef` must match `^[a-z0-9/_-]+$` and names a secret; the runtime reads the environment variable of the same name upper-cased with non-alphanumerics as `_` (ECS injects Secrets Manager values that way; there is no other platform secret adapter yet). No endpoint returns, logs or stores a secret; status shows `secretRefSet` as a boolean.

## Data rules (enforced, each with a test)

- Aggregates only. Pulled rows are `(day, dimensionKey, metric, value)`; `dimensionKey` is a campaign key, a page **template** group (`template:doctor`), a channel, a country or a message category. Search Console page paths are collapsed to a template inside the adapter; no path, query, specialty, provider, booking or person leaves or enters (`no-health-targeting.unit.spec.ts`: no import of patient, booking, catalog, lifecycle, segment, referral modules, no specialty or id words, no logging of headers or tokens, vendor hosts only under `platform/adapters`).
- Outbound conversions: `assertAdSafe` is a closed allow-list `{eventName, occurredAtHour, market, valueMinor?, currency?, campaignRef, clickId?}`; extra keys, PHI, identifier-shaped strings, health or person words are refused; the timestamp is rounded to the hour and the value to a bucket (default 1000 piastres); `clickId` needs analytics consent. Conversion **upload is not implemented** against any vendor: `push-conversions.job.ts` is default off, counts and sends nothing in mock, and refuses `real` (NEEDS_HUMAN, H-9).
- No third-party tag, pixel or SDK on authenticated pages or the booking flow. This phase adds none (the Playwright bundle scan for ad domains of P1 stays green; the new code only calls vendors from the server).
- Mock data is labelled synthetic in status, reports and the ops UI. The scheduled job does not run mock pulls on a production API, so synthetic numbers never sit next to real campaign figures. Real paid spend becomes **PENDING** campaign spend lines (`source=ADAPTER`, de-duplicated by `(campaignId, day, source, adapterRef)`), so maker-checker still applies; mock mode never writes spend lines.

## Behaviour

- Per-kind flag `growth.integrations.<kind>` (default ON, mock). OFF: runs are skipped (`FLAG_OFF`), stored aggregates stay and the page says why.
- Circuit breaker: OPEN after 5 consecutive failed runs, single probe after 30 min (HALF_OPEN), CLOSED on success. A failed run enqueues one `IntegrationRunFailed` (dedupe key is the run id).
- Retry: 3 attempts with full-jitter backoff on timeout and 5xx and 429; never on a parse or 4xx error. Rate budget: runs per hour per integration (`rateBudgetPerHour`, 429 `INTEGRATION_RATE_BUDGET`).
- Idempotent store: a run replaces the rows of its own window, keys and metrics inside one transaction. Retention job deletes aggregates older than 25 months (13 for CrUX and push health) and run rows older than 400 days.
- Real mode without a resolvable secret: `NEEDS_HUMAN`, run FAILED with error `NEEDS_HUMAN`, nothing stored, no network call. A real manual pull needs a request by one super admin and confirmation by a different one within an hour (single use, both audited).

## Analytics definitions

CAC = spend / attended new patients. Spend is approved manual spend, replaced by the adapter figure when the two differ by more than 5 percent (the note `ADAPTER_WINS` and the delta in basis points are shown). Blended CAC adds reward cost (REDEEM minus REVERSE of marketing-funded lots) and is always shown beside the figure without it. ROAS = Kiorex revenue facts in the window / spend (labelled revenue to date, finance view). MER = revenue / total marketing spend. Every ratio hides itself under k < 10 people or under the spend floor (EGP 500) and prints its reason; missing external data is "not connected", never zero. Also: paid versus organic mix, install to registration and registration to first booking (only with stores connected and k >= 10), organic search by page template, CWV percentiles.

## Integration table (VERIFY AT BUILD for every API name and version; client budgets, not vendor claims)

| Integration | Purpose | API | Auth | In and out | Retention | Location | Client budget | Failure | Fallback | Real adapter parse |
|---|---|---|---|---|---|---|---|---|---|---|
| Google Ads | spend and clicks | GoogleAdsService.SearchStream | OAuth refresh token and developer token, `secretRef` | in: cost, clicks, impressions by campaign; out: none (conversion upload off) | 25 months, raw 7 days max | Kiorex cell (frankfurt), aggregates cross-border | 60/min, daily | breaker after 5, partial marked, `IntegrationRunFailed` | manual spend | recorded fixture |
| Search Console | organic by page template | searchAnalytics.query | service account | in: clicks, impressions by template | 25 months | Kiorex cell | 30/min | stale banner after 3 days | manual CSV | recorded fixture |
| GA4 | optional comparison | properties.runReport | service account | in: sessions, conversions by channel; no Measurement Protocol | 25 months | Kiorex cell | 30/min | skip, "not connected" | first-party | recorded fixture |
| Play Console | installs, listing, crashes | Play Developer Reporting API and CSV exports | service account | in: aggregates by country | 25 months | Kiorex cell | 20/min | stale banner | manual CSV | NEEDS_HUMAN until a sample is recorded (H-9) |
| App Store Connect | impressions, downloads | analytics reports | JWT, key as `secretRef` | in: aggregates | 25 months | Kiorex cell | 20/min | stale banner | manual CSV | NEEDS_HUMAN until a sample is recorded (H-9) |
| Meta Ads | spend and results | Marketing API insights | system user token | in: spend, impressions, clicks | 25 months | Kiorex cell | 60/min | breaker | manual spend | recorded fixture |
| WhatsApp Cloud | conversation counts and cost by category | conversation analytics | permanent token | in: counts and cost | 25 months | Kiorex cell | 30/min | stale banner | MessageLog counts | recorded fixture |
| TikTok | spend and results | Marketing API reporting | access token | as Meta | 25 months | Kiorex cell | 30/min | breaker | manual spend | recorded fixture |
| FCM and APNs | push delivery health | existing messaging adapters | existing keys | counts only | 13 months | Kiorex cell | n/a | token cleanup | in-app | health only, mock series |
| CrUX | field CWV | records:queryRecord | API key `secretRef` | p75 LCP, INP, CLS | 13 months | Kiorex cell | 10/min | skip | synthetic Lighthouse | recorded fixture |

## Gaps (carried to the register)

1. Play Console and App Store Connect real parsers wait for recorded samples (H-9). 2. FCM and APNs real mode has no pull of its own (health only); the mock series stands in. 3. No conversion upload to any vendor (default off by design). 4. Secrets resolve from environment variables injected by ECS; a Secrets Manager client in `platform/adapters` is not added. 5. The ops "pull now" confirm shares a request id between two people by hand. 6. Real adapters were never run against a vendor (never in CI, no accounts).
