# Growth and patient acquisition engine: data model (Wave 1, GRW-P1-B0)

Plan: `kiorex-v2/_docs/growth/` (ARCH = GROWTH_ARCHITECTURE_DECISIONS.md, work packages = GROWTH_PHASE1_WORK_PACKAGES.md). Contract: `@kiorex/contracts` 1.10.0. Every default named here is `PROPOSED_DEFAULT` until the founder ratifies it.

## Tables (migration `20261128100000_growth_core`, additive and idempotent)
| Table | Purpose | Rules |
|---|---|---|
| `GrowthAcquisitionSource` | taxonomy of `(sourceKind, sourceRef)` | unique per market |
| `GrowthTouchpoint` | one observation; no IP (keyed hash, blanked after 24 h), UA class only, referrer host only | append-only trigger `growth_touchpoint_immutable` |
| `GrowthAttributionDecision` | one per `(bookingId, policyVersionId)`; origin, reason, `inputsHash`, evidence touch ids | append-only trigger `growth_attribution_decision_immutable`, no bypass; correction = new row with `supersedesId` |
| `GrowthEvent`, `GrowthMetricDaily` | canonical funnel events and idempotent daily rollups | allow-listed props (service layer, package B) |
| `GrowthConfigVersion` | versioned config, `scopeId=''` for GLOBAL | one ACTIVE per `(kind, scope, scopeId)` (partial unique index), `approvedBy <> createdBy` CHECK |
| `GrowthSlug`, `GrowthSlugHistory`, `GrowthLandingPage` | SEO slugs (301 history) and page descriptors | slug `[a-z0-9-]{3,60}` |
| `WidgetRegistration` | verified widget origins from the Clinic projection | CHECK: https exact origins, at most 10 |
| `GrowthFraudSignal`, `CommunicationSuppression` | fraud rule hits; suppression by keyed hash only | |
| `BookingIntent.acquisitionOrigin`, `.attributionDecisionId` | the only change to an existing table; nullable | null = UNATTRIBUTED (today's behaviour) |

All growth tables carry `market` (default `EG`); no code branches on a country.

## SQL functions (SECURITY DEFINER, both write an `AuditLog` row)
- `growth_erase_subject(sub)`: deletes the subject's touches and the visitor keys linked to it with their funnel events; touches that a decision cites as commission evidence are anonymised (identifiers nulled) because the evidence outlives the person. Audit stores `sha256(sub)`.
- `growth_purge_expired(now, linkedMonths, unlinkedMonths)`: blanks IP hashes older than 24 h, deletes unlinked touches older than 13 months and decision-cited touches older than 25 months (parameters come from `ATTRIBUTION_POLICY`), old events and fraud signals.
- `GrowthMaintenanceService` (`src/growth/maintenance`) wraps both; Wave 2 consumers call it.
- Known limit: the append-only guard protects against application bugs, not against a database role that sets the `kx.growth_maintenance` marker itself; production roles should keep the app role off superuser/owner rights where possible (NEEDS_HUMAN with the AWS role design).

## Modules
`src/growth` (core, owner B), `src/public-site` (E), `src/widget` (G): registered in `app.module.ts`, each with a `*-public.ts` façade; `module-boundaries.unit.spec.ts` enforces the rules.

## Flags (catalogue and contracts 1.10.0)
`growth.provider_links` (Clinic snapshot), `growth.attribution`, `growth.ssr_public_pages`, `growth.seo_landing_pages`, `growth.widgets`, `growth.deep_links`, `growth.campaigns`, `growth.experiments` ship ON. Launch-locked until counsel evidence: `growth.analytics_visitor`, `growth.marketing_messaging`, `growth.patient_referral`, `growth.rewards`, `kiorex.whatsapp_ai_assistant`. Safety is never a flag (ADR-025). Constants: `GROWTH_FLAG` in `src/growth/growth-flags.ts`.

## Default configuration
`src/growth/config/growth-defaults.ts` holds the PROPOSED_DEFAULT payloads (30 day provider window, 7 day campaign window, `PROVIDER_FIRST`, 1000 ms dwell, 25/13 month retention, thin-page guard 3 providers and 70 % overlap, widget 10 origins). They validate against the contract JSON Schemas and are the fallback when no ACTIVE version exists.
