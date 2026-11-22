# Kiorex API architecture

NestJS 12 + Prisma 7 modular monolith (`apps/api`), PostgreSQL 16+, port 4000, prefix `/api/v1`. Same discipline as Kiorly Clinic.

## Bounded contexts (src/<module>/, façade `<module>-public.ts`)

| Module | Owns | Requirements |
|---|---|---|
| auth | Passport JWT (JWKS via jose), roles from `kx_roles`, sessions, back-channel logout | KXM-AC-01/05, KA05/07 |
| patient | profile (national ID AES-256-GCM + blind index), dependants, consent centre, export/deletion, Kiorly link rule | KXM-AC-02..07 |
| catalog | provider projection from Kiorly sync (5 min + events), trigram/FTS search, slots cache (60 s), analytics, profile-view push | KXM-DS-01..08, PR-01..05 |
| booking | intent/hold/confirm state machine (KX-03 §05), cancel/reschedule, nightly reconciliation, circuit breaker via kiorly client | KXM-BK-01..10 |
| kiorly | HMAC client (@kiorex/contracts), typed commands, per-clinic circuit breaker | KX-09 §02–03 |
| webhooks | `POST /webhooks/kiorly` HMAC verify, eventId dedupe, routing | KX-09 §04 |
| pay | PSP adapters (paymob/fawry/instapay; `sandbox-fake`), deposits, refunds, pay links, payouts, double-entry ledger, reconciliation | KXM-PAY-01..05 |
| engagement | notifications through the messaging hub (`MESSAGING_MODE=mock`), reminders T-24h/T-2h, consent, quiet hours | KXM-NT-01..03 |
| trust | verified reviews, moderation (PHI/abuse), aggregate sync, complaints | KXM-RV-01..03 |
| control-plane | flag registry (KX-08 §09), evaluation, gates, two-person rule, audit, signed snapshots, push, propagation | KXM-OP-07..11 |
| ops | admin API (directory, timeline, outbox, payments, moderation, liquidity) | KXM-OP-01..06 |
| ai-gateway | provider abstraction (fake / openai-eu), redaction, labels, quota | KX-11 |
| safety | emergency routing (123), symptom→specialty map, PHI redaction — **safety controls, never flags** | KXM-DS-06, KX-16 |
| messaging | unified EMAIL/WHATSAPP/SMS/PUSH hub: `MessagingAdapter` (mock/real), `MessageLog` (dev inbox + ops view), delivery-state simulation, `/dev/messaging/*` (non-prod, mock only) | KXM-NT, KX-00 provider rules |
| market | `market.<cc>.live` gate: sign-up/search visibility, 403 on profile/slots/booking | KXM-OP-09 |
| analytics | PHI-free client event ingestion (closed whitelist, anonymous) | KX-03 §07 |
| records | patient vault, Kiorly record shares (KX-11), Rx verification QR, follow-ups, storage adapter | KXM-RC-01..03 |
| waitlist | patient waitlist + SLOTS_CHANGED autofill offers | KXM-BK-12 |
| channels | WhatsApp booking state machine over the messaging hub | KXM-BK-11 |
| pharmacy / lab | launch-locked verticals: cart/order intent/payment, draft partner HMAC clients, partner events, take-rate ledger | KX-03 §08 |
| telemedicine | launch-locked session orchestration, `VideoAdapter` (mock) | KX-03 §08 |
| outbox | transactional outbox + 5 s dispatcher, backoff, DEAD after 8, replay | KX-09 §01 |

Rule (tested in `module-boundaries.unit.spec.ts`): modules import each other only via `*-public.ts`; shared kernel = `common/`, `prisma/`.
Modules never share DBs with other products; Kiorly is the only system of record for appointments (ADR-005).

## Notifications (shared layer)

Outbound messages go through `NotificationService` from `@kiorex/contracts/notify` (contracts 1.7.0), never straight to the messaging hub. `engagement` owns the templates and the preference store; `messaging` owns the channel adapters (`HubChannelAdapter`, `InboxChannelAdapter`) over `MessagingHub` (MessageLog, mock/real, vendor mapping). The layer applies consent, opt-out, quiet hours, the PHI-free guard and per-channel rendering (ar/en); status webhooks use the shared normalized status. The in-app inbox is the `Message` table (channel `INAPP`). See [PROVIDERS.md section 7](PROVIDERS.md) and `kiorex-contracts/docs/NOTIFICATION_LAYER.md`.

## Money (Kiorex Pay ledger only; three ledgers never commingled)

Integer minor units. Every money path = idempotency key + outbox event + ledger entry + reconciliation + property tests.
Accounts: `PSP_CLEARING`, `HELD:<clinic>`, `PAYABLE:<clinic>`, `REFUND_PAYABLE`, `PSP_FEES`, `MARKETPLACE_FEES` (vertical take; partner sub-accounts `ph:<id>` / `lab:<id>` reuse HELD/PAYABLE). DB enforces single-sided entries and a deferred
balanced-transaction trigger. Capture → HELD; COMPLETED/NO_SHOW → PAYABLE (release/forfeit); weekly payout drains PAYABLE and calls Kiorly
`POST /payouts` (payoutRef); refunds go HELD → REFUND_PAYABLE → settled. Captured-but-booking-dead ⇒ automatic refund.

## Booking consistency

Hold → confirm with `Idempotency-Key = Kiorex booking id`. Timeout/5xx ⇒ intent stays `HELD` with `callState=UNCERTAIN`; the next step is
`GET /bookings/:ref` (never a new key); nightly job re-reads non-terminal intents idle > 24 h. Circuit open ⇒ new holds for that clinic return 503.

## Feature flags

Registry in this API; Kiorex modules evaluate locally (`FlagsService`, cache ≤ 1 s) via `@RequiresFlag` → `403 FEATURE_DISABLED {key, scope}`.
Evaluation = `@kiorex/contracts` `evaluateFlag` (any-OFF-wins, gate evidence, dependencies). Snapshot: `GET /control/v1/flags/snapshot?product=`
(HMAC product key, ETag, signed with `signSnapshot`); `flag.changed` push via outbox, Kiorly webhook signature scheme.
