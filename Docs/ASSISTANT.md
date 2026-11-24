# WhatsApp AI booking assistant (GRW-P2-D)

Status: **As-built locally, mock model, flags locked, nothing deployed** (24 Nov 2026, Wave 6 lane A3). ADR-058 (Proposed, unsigned). This file is the design and the safety-case input for the CMO review. It describes only what the code does.

## 1. What it is, in one paragraph

A patient writes to the Kiorex WhatsApp number in Arabic (Egyptian or Modern Standard) or English. A **front stage** (`AssistantRouter`, called from `channels/whatsapp-booking.service.ts`, the only edit to that file) decides whether the assistant answers. If it does, a small loop (`AssistantOrchestrator`) cleans the text, runs the safety screens, asks a **model for one structured step**, validates it, runs **one tool** bound to the existing `BookingService` / `CatalogService` / `WaitlistService`, renders a **fixed template** from the tool output and sends **one** message. Whenever the assistant does not answer (flag, consent, budget, rate, concurrency, model failure, any error) the router returns `DETERMINISTIC` and the existing booking state machine answers exactly as it did before. The model is **mock by default**: no vendor, no network, no cost.

```
inbound -> WhatsAppBookingService.handle -> AssistantRouter.route
              | flag, no flow in progress, consent, budgets+breaker, rate, concurrency  (any miss: DETERMINISTIC)
              v
        AssistantOrchestrator.turn
          sanitise -> dedupe -> [emergency | STOP is the machine's | button payload | human request | injection | medical question]
          -> model step (validated) -> policy(state) -> tool (args, ids, ownership) -> render -> output scan -> ONE outbound
```

## 2. The two rules that make it safe

1. **The model never writes to the patient.** It returns a `ModelStep` (`tool`, `reply_intent`, `clarify` or `handoff`, JSON-schema constrained, extra keys rejected). Every sentence the patient reads is a fixed template (`assistant.render.ts`: English, Egyptian-neutral Arabic, Modern Standard Arabic) filled from tool output. Names, fees and times are never taken from the model or from the patient.
2. **The model never decides an action that changes a booking.** Booking, rescheduling and cancelling are executed by code when the *current inbound message is the exact button payload* `CONFIRM:<id>:<nonce>` of an unused, unexpired nonce bound to that session and that verified patient. Typed "yes" never confirms. A model can ask for the buttons (`prepare_confirmation`, `cancel_booking`, `reschedule_booking`); it cannot press them.

## 3. Tools (closed registry, `assistant.tools.ts`)

Every tool has a JSON Schema (also what a real model is told); the validator is generated from the same table. **No tool takes a subject, phone, tenant or any identity argument** (unknown key: `ARG_NOT_ALLOWED`). Every id (provider, slot, hold, booking) must have been shown earlier in this session (`idsSeen`; else `ID_NOT_SEEN`). Dates are inside today to today + 30 days. A `specialty` argument must be a closed `SpecialtyCode` the patient named or picked by number from the list we showed (`SPECIALTY_NOT_NAMED` otherwise): **the model never maps a symptom to a specialty**; a symptom message gets the fixed specialty-choice list.

| Tool | Does | Notes |
|---|---|---|
| `search_providers` | `CatalogService.search` (specialty, district, max price, same day or date, sort by price) | read only; district falls back to "nearest" with a notice |
| `get_slots`, `get_next_available` | `CatalogService.slots` of a provider already shown; time-of-day filter | max 5 shown |
| `hold_slot` | `BookingService.createIntent` (5 minute hold, `channel: WHATSAPP`) | replaces a previous hold |
| `prepare_confirmation` | issues the nonce, renders fee, time and doctor, sends Confirm / Cancel buttons | nonce TTL = hold TTL |
| `confirm_booking` | the only executor of confirm, decline, cancel and reschedule | button payload only; idempotent on a second press |
| `get_my_bookings` | the patient's next 5 bookings by start time | owner only |
| `cancel_booking`, `reschedule_booking` | show the refund consequence from the booking data, issue their own nonce | executed only by `confirm_booking` |
| `join_waitlist` | `WaitlistService.join` | only after a search found no free time |
| `create_booking_link` | one-time signed link, 15 minutes | the **only** source of URLs; unverified numbers get `VERIFY` |
| `handoff_to_human`, `end_conversation` | escalation, close | |

State to allowed tools is a code table (`assistant.policy.ts`); `ASSISTANT_POLICY` can only narrow it. Unverified numbers (no Kiorex profile) get search tools and the link only, and only while the model runs inside the platform (mock or fixture); a real model never receives an unverified number's text.

## 4. Safety controls (code, never flags, ADR-025)

| Control | Where | Behaviour |
|---|---|---|
| Emergency pre-empt | router runs before the machine's own step; orchestrator checks again before any model call | fixed 123 guidance (`EMERGENCY_GUIDANCE`, `NEEDS_HUMAN_APPROVAL`), hold released, **no queue, no model**; works with every flag OFF |
| Opt-out | `STOP` words are never the assistant's | the machine records the suppression |
| Sanitiser | `sanitiseInbound` | strips control, bidi override, zero-width and tag characters, NFKC, removes URLs, 1,000 character cap (over-long: fixed text, not sent to the model) |
| Injection screen | `injectionSignals` (EN, AR, mixed; obfuscated forms are sanitised first) | fixed refusal, audit row with signal labels only; the 76-case corpus runs in CI |
| Medical advice | inbound `asksMedicalAdvice` and outbound `scanOutbound` | fixed referral text (specialty choice or a person); dose, diagnosis, treatment patterns in AR and EN; replaced even if produced by a template or a tool value |
| Prompt leak | canary `KXA-CANARY-...` in the model's static system prompt; `scanOutbound` | message replaced |
| URLs | `scanOutbound` | every URL stripped except those `create_booking_link` made this turn |
| Media | empty text with no button | fixed text, never forwarded |
| Dedupe | provider message id, or same text in the same context within 30 s | answered once |
| Human | `handoff_to_human`, trigger words ("agent", "موظف", "عايز اكلم حد"), two clarify failures | escalation with SLA (`ASSISTANT_POLICY.escalationSlaMinutes`) and redacted transcript; assistant silent until a human closes it |

## 5. Consent, privacy, retention

* First assistant message of a session says (in the patient's language) that it is an automated assistant and that a person is available.
* Verified patients need the existing `AI_PROCESSING` consent, otherwise `DETERMINISTIC`. (The invitation text for the consent is `TODO_NEEDS_HUMAN` and is not sent by the machine: see section 9.)
* The model sees the **redacted** text (`redactForModel`: phone, e-mail, national id, name claims, digit runs; emergency text withheld). Stored turn text is `redactForStorage`: the same, plus a `[HEALTH_TEXT]` marker for any symptom, emergency or drug/dose/diagnosis message. **Outbound bodies are never stored** (template key only), so a doctor or booking is not recorded in free text. Phone numbers are stored only as a keyed hash.
* Audit rows (`AuditLog`, `assistant.*`) carry ids, counters, tool names, modes and hashes only (an allow-list of keys).
* Retention: turn text 30 days (`retentionDays`), tool calls 12 months, sessions 24 h after the last message; expiry releases holds and revokes pending buttons (`AssistantRetentionJob`); the removal itself is the existing `growth_purge_expired_v2`. Erasure: `growth_erase_subject` deletes sessions and, by cascade, turns, tool calls, confirmations and escalations.

## 6. Budgets, breaker, rate

`ASSISTANT_POLICY` (maker-checker): per-turn tokens 1,500, per conversation 8,000 tokens and 40 turns, per person per day 30,000 tokens, per market per day cost cap (breaker at 100 percent: `AssistantBudgetBreakerTripped` audit row and ops banner, `DETERMINISTIC` until midnight Cairo or a super admin reset), 30 messages per number per hour (one polite notice, then silence), global concurrency 50. Mock mode costs 0 and counts synthetic tokens (`ASSISTANT_MOCK_COST_PER_1K_MINOR` makes the breaker testable). Every model call is also an `AiUsage` row (`purpose = whatsapp_assistant`).

## 7. Models

`AssistantModel { name; mode; step(input) }`. `mock` (default; rules and `model/fixtures/lexicon-eg.json`: 60+ colloquial Arabic phrases, Arabic-Indic numerals, بكرة، بعد بكرة، الصبح، العصر، بالليل, districts), `fixture` (replays JSONL, `ASSISTANT_FIXTURE_FILE`), `openai-compat` (config only). `FallbackChain` = primary, secondary, each behind a breaker and an 8 s timeout; all failing means `DETERMINISTIC`. `assistant.model.factory.ts` constructs the real model **only** when the policy says `real`, `growth.assistant_real_model` is effective (gate evidence), and `ASSISTANT_BASE_URL`, `ASSISTANT_MODEL` and `ASSISTANT_API_KEY` exist; any miss falls back to the mock. A unit test proves no other file in the module can reach the network.

## 8. Operating it (ops console, Growth, WhatsApp and Assistant)

Four views: **Assistant** (mode, gate status, policy version, "what never changes"), **Conversations** (no phone; transcript for support and super admin only, redacted, audited), **Escalations** (SLA timers, acknowledge, close), **Budgets** (limits, today, last 14 days, breaker reset, metrics hidden under 10 conversations). API: `/api/v1/admin/growth/assistant/{status,conversations,escalations,budgets,metrics}`. Public: `POST /api/v1/growth/v1/assistant/link` (contract 1.1.0, 403 `FEATURE_DISABLED` while the flag is locked).

Flags: `kiorex.whatsapp_ai_assistant` (launch-locked until the safety review) and `growth.assistant_real_model` (launch-locked). In dev, tests use a DEV fixture gate (`DEV-TEST-FIXTURE-NOT-A-REAL-GATE`), never a real one.

## 9. Not built, not decided (NEEDS_HUMAN or later work)

* Live WhatsApp interactive reply buttons: the platform adapter (`messaging/*`, not in this package) sends text; `data.buttons` is passed and the mock inbox lists the buttons as text. Meta interactive message and template approval are open.
* Consent invitation for `AI_PROCESSING`, emergency wording, disclosure wording, refund wording, Arabic review by a native speaker, CMO sign-off: all `TODO_NEEDS_HUMAN` / `NEEDS_HUMAN_APPROVAL`.
* Real model: vendor, DPA, EU endpoint, key; recorded fixtures from staging (`ASSISTANT_RECORD=1`, dev only).
* Patient web route that consumes `continuePath` (`/book`, `/signin?next=`, `/bookings/:id/pay`).
* Clinic acceptance of `KIOREX_WHATSAPP` (`KIORLY_ACCEPTS_WHATSAPP_CHANNEL`, NH-042): until then the booking keeps `MARKETPLACE` plus `attribution.source = kiorex_whatsapp`.
* The Clinic waitlist endpoint is still not called by Kiorex: `join_waitlist` writes the same local entry as the deterministic machine.

## 10. Tests

Unit (`src/ai-gateway/assistant/*.unit.spec.ts`): policy table, tool schemas and argument refusals, safety (sanitiser, screens, PHI redaction, output scanner, delimited field), lexicon, renderer in three registers, model port, mock, fixture, fallback chain with breaker and timeout, config-only real model, recorder refusal in production, static no-network proof. Integration (`test/assistant*.int.spec.ts`, real database, real `BookingService`, mock messaging): golden paths in English, Egyptian and Modern Standard Arabic, cancel, reschedule, waitlist, hand-off, consent missing, flag OFF, unverified number and link, hold expiry, double press, foreign and forged nonces, emergency, media and over-long text, model failure fallbacks, budgets and breaker, rate, privacy and erasure, retention, no outbound fetch, ops API, fixture conversations (`test/fixtures/assistant/*.jsonl`) and the red-team corpus (76 cases, run against the mock model **and** against a model that obeys every injection). Ops vitest: `src/__tests__/growth-assistant.test.tsx`. End to end: `e2e/test/33-assistant.e2e.ts` (real Passport patient, real Clinic slot, mock model).
