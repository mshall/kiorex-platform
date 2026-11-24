# Consent, communication preferences and the preference centre (GRW-P1-I)

Plan: `kiorex-v2/_docs/growth/` (ARCH section 9, work-packages package I). Contract: `@kiorex/contracts` 1.10.0 (`PatientConsentUpdated`). Every default is `PROPOSED_DEFAULT`; the wording is `TODO_NEEDS_HUMAN` until counsel approves it (AR and EN). Marketing is launch-locked (`growth.marketing_messaging`) and the engine runs on mock adapters.

## Purposes and the rule of separation
| Purpose | What it covers | Needs | Never blocked by |
|---|---|---|---|
| `TRANSACTIONAL` | booking confirmations, receipts, cancellations | `MARKETPLACE_PROCESSING` consent (existing), channel not opted out | marketing consent, suppression, caps, the marketing flag |
| `SECURITY` | sign-in codes, new-device alerts | nothing (ignores opt-out and quiet hours: an OTP must arrive) | everything marketing |
| `CLINICAL` | care-critical alerts (results ready, safety) | follows the KX-24 severity rules (CRITICAL bypasses quiet hours) | everything marketing |
| `REMINDER` | appointment reminders, follow-ups | `REMINDERS` consent | everything marketing |
| `MARKETING` | news and offers | `growth.marketing_messaging` effective, a granted `MARKETING_<channel>` consent, channel not opted out, address not suppressed, outside quiet hours, inside the frequency caps | nothing: ALL of these must hold |

A message template is bound to exactly ONE purpose when it is defined (`Template.marketing` selects `MARKETING`); no shipped template is marketing. A unit test (`marketing-binding.unit.spec.ts`) proves no shipped template is marketing and that marketing can never ride another purpose. In-app inbox marketing is still marketing: it needs the push consent (`MARKETING_PUSH`) and obeys the caps.

## Consent records (append-only audit trail)
`ConsentRecord` rows: `sub`, `purpose`, `granted`, `version` (the text version id), `source` (`web|app|whatsapp|widget|ops-import`; internal callers may pass their own label), `channel` (marketing purposes), `ipHash` (keyed hash with a daily-rotating salt, never the IP), `evidence` (button id), `createdAt`. A database trigger refuses UPDATE and DELETE; a withdrawal is a new row and the latest row wins. New purposes: `ANALYTICS_MEASUREMENT`, `MARKETING_WHATSAPP`, `MARKETING_SMS`, `MARKETING_EMAIL`, `MARKETING_PUSH`. The Rev 2.2 consent list (`GET /me/consents`, five purposes) is unchanged; `PUT /me/consents/:purpose` also accepts the new purposes with optional `source`, `textVersion`, `evidence`.

Every change writes the record AND an internal outbox event `PatientConsentUpdated` `{subRef, purpose, channel?, granted, textVersion, source, at}` in the same transaction (`subRef` is a keyed hash, never the Passport sub, a phone or an e-mail). The send gate reads the database directly, so a withdrawal is effective for the next send (SLO 60 s, `CONSENT_DEFAULTS.withdrawalPropagationSeconds`).

Anonymous visitors: `POST /api/v1/growth/v1/consent` `{analytics, marketing?, textVersion?, source?, evidence?}` writes an append-only `GrowthVisitorConsent` row keyed by a random `kxc_` id (no sub, no cookie value, no IP) and answers `201 {consentId, analytics, marketing, textVersion, at}`. A reject also clears an existing `kxv` cookie. `GET /api/v1/growth/v1/consent/versions` returns the text version ids the banner must store.

## Preference centre API
`GET /api/v1/me/preferences`: service messages (required, not switchable), reminders, analytics, per-channel marketing consent (all OFF by default: nothing is pre-ticked), channel switches, suppression state, quiet hours (personal window or the market default 21:00 to 09:00 `Africa/Cairo`), caps (default 1 a day, 3 a week across channels), `marketing.available` (false while the flag is locked), `draftWording`. `PUT /api/v1/me/preferences` changes any of them (unchanged values write no row). `POST /api/v1/me/preferences/unsubscribe-marketing` is the one-step opt-out of every marketing channel.

## Send gate (notification layer)
`PlatformPreferenceStore` (engagement) feeds the shared notification layer. For MARKETING it asks: flag, per-channel consent, channel opt-out, suppression, personal or default quiet window. `EngagementService.deliver` adds the cross-channel frequency cap (`SKIPPED_FREQUENCY_CAP`, counting distinct logical sends so a fan-out is one send). The pure matrix is `growth/consent/consent-gate.ts` (`evaluateSend`), unit-tested over purpose x channel x consent x suppression x quiet hours x caps.

## Suppression list
`CommunicationSuppression` stores a KEYED HASH of the phone or e-mail (never the raw value), per market and channel (`ALL` covers every channel). It blocks marketing only. WhatsApp `STOP` (and `unsubscribe`, `ايقاف`, `وقف`, `الغاء الاشتراك`) writes it, turns the WhatsApp channel off and withdraws `MARKETING_WHATSAPP`; this runs BEFORE the `kiorex.whatsapp_booking` flag check because an opt-out is a legal act, never a feature. A bare `الغاء` keeps its old meaning (cancel the booking conversation).

## Web
`ConsentBanner` (equal-weight Accept and Reject, "Choose what to allow" with unticked analytics and marketing switches, draft chip outside production), `PreferenceCentre` and the page `/preferences` and `/:locale/:cc/preferences` (noindex), a footer link, `lib/consent.ts` (storage with the wording version, `consentHeaders`, `sendTouch`, `touchBodyFrom`). Nothing is stored or sent before a choice; after an accept ONE landing touch is sent after the page has been on screen ~1.2 s (`dwellMs`) with `X-KX-Consent: analytics`. The `kxv` cookie is set by the API only with that header AND the `growth.analytics_visitor` gate satisfied.

## NEEDS_HUMAN
Consent wording AR/EN (banner, centre, per-channel marketing, WhatsApp opt-in), the regime id and defaults, the marketing licence question and the DPO review. Until then text versions are `TODO_NEEDS_HUMAN_v0` and the UI shows a visible "draft" marker outside production.

## Tests
`consent-gate.unit.spec.ts`, `marketing-binding.unit.spec.ts`, `test/consent.int.spec.ts` (records, preference centre, enforcement, suppression, caps, quiet hours, STOP, isolation), `test/growth-ingest.int.spec.ts` (banner cookie contract), `apps/web/e2e/consent.spec.ts` (banner and centre in a real browser), `apps/web/src/__tests__/consent.test.ts`.
