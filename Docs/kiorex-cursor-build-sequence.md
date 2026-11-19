# Kiorex platform — build sequence & progress tracker

Status: `[x]` done · `[~]` partial · `[ ]` open. Requirement IDs from KX-03/KX-04/KX-08/KX-09/KX-11/KX-16.

## Phase 0 — foundations
- [x] KXP-00 Root npm workspaces, scripts, CI, CODEOWNERS, `.cursor` rules, Docs hub
- [x] KXP-01 apps/api skeleton: Nest 10, Prisma 6 schema + migrations (pg_trgm, ledger triggers), config, error contract
- [x] KXP-02 Outbox (5 s loop, backoff, DEAD after 8, replay)
- [x] KXP-03 Auth: JWKS verify, roles, sessions, back-channel logout (KXM-AC-01/05)
- [x] KXP-04 `@kiorex/contracts` adoption (HMAC, evaluateFlag, snapshot signature, event validation)
- [x] KXP-05 OpenAPI export + `Docs/API.md`

## Phase 1 — marketplace
- [x] KXP-10 Patient: profile/encrypted ID, dependants, consents, export/deletion, Kiorly link rule (AC-02..07)
- [x] KXP-11 Catalog sync + search + slots + emergency routing + analytics push (DS-01..08, PR-01..05)
- [x] KXP-12 Booking orchestration + state machine + reconciliation + circuit breaker (BK-01..09)
- [x] KXP-13 Webhooks (HMAC, dedupe, side-effect table)
- [x] KXP-14 Kiorex Pay: deposits, refunds, links, payouts, ledger, reconciliation, property tests (PAY-01..05)
- [x] KXP-15 Engagement (NT-01..03)
- [x] KXP-16 Trust (RV-01..03)
- [~] KXP-17 Booking channels: CLINIC_LINK passthrough done; WhatsApp channel (BK-11) and waitlist (BK-12) are P2 stubs

## Phase 2 — control plane & ops
- [x] KXP-20 Flag registry (full KX-08 §09), evaluation, `FEATURE_DISABLED` guard
- [x] KXP-21 Gate evidence, dependencies, expiry/schedule, two-person rule + emergency kill, audit/export (OP-08..11)
- [x] KXP-22 Signed snapshot + ETag + push + propagation (OP-07/11)
- [x] KXP-23 Ops admin API (OP-01..06)
- [x] KXP-24 AI gateway (fake + openai-eu), redaction, quota, labels
- [x] KXP-25 Tests: unit, integration, contract, flag-OFF per flag, property-based

## Open
- [ ] KXP-30 Enforce `market.<cc>.live` (gated: NEEDS_HUMAN #16)
- [ ] KXP-31 Real PSP adapters (NEEDS_HUMAN #4)
- [ ] KXP-32 Real messaging senders (NEEDS_HUMAN #5)
- [ ] KXP-33 Waitlist (BK-12), WhatsApp booking (BK-11), records & continuity (RC-01..03, P2)
- [ ] KXP-34 Deployment (do not deploy until the founder says so; infra by another agent)
