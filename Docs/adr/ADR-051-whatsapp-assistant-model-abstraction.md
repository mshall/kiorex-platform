# ADR-051: WhatsApp assistant model abstraction, tool confirmation and fallback

- Status: **PROPOSED** (not signed). Package GRW-P2-D. Numbering: this amends the assistant tool decision once reserved as ADR-048. Scheme A (25 Nov 2026): **ADR-051 everywhere**, including `GROWTH_ARCHITECTURE_DECISIONS.md` section 24, which called it ADR-058 until then; the founder confirmed the scheme on 25 Nov 2026 (launch guide 11.1); the ADR is still Proposed and unsigned.

## Context
An assistant that books on WhatsApp must not be able to act on a model's say-so, leak data across patients or answer medical questions.

## Decision
- The model sits behind a port (`mock`, `fixture`, config-only `openai-compat`) with a circuit breaker, timeout and a fallback chain; **any failure falls back to the deterministic booking machine**. The real model is launch-locked (`growth.assistant_real_model`, safety review gate).
- The model returns **structured steps only**; every patient-visible sentence is a fixed template from tool output. Tools take no subject, phone or tenant; every id must have been shown in the session.
- **Booking, reschedule and cancel run only on the exact `CONFIRM:<id>:<nonce>` button payload** of an unused, unexpired nonce bound to the session and the verified patient.
- Emergency detection runs before the machine and before any model call; it is a safety control, never a flag. Medical-advice questions, injection patterns and media get fixed answers without the model.
- Outbound text is scanned (no medical advice, no unknown URL); stored turns are redacted; budgets and rate limits stop the model, not the machine.

## Consequences
Real WhatsApp buttons need the Meta adapter; native-speaker and CMO review are human items (launch guide 11.13a to 11.13l).
