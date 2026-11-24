# ADR-052: Lifecycle message classes and send gate

- Status: **PROPOSED** (not signed). Package GRW-P2-E.

## Context
Patients receive transactional, safety and marketing messages through the same channels; marketing must respect consent, quiet hours and frequency, and safety must never be blocked by marketing rules.

## Decision
- Every template carries one of four **message classes**; a **pure send gate** decides send, delay or suppress from (class, consent, quiet hours with the market time zone, frequency budget shared with campaigns, suppression, holdout) and records a decision with a reason code.
- **Safety and transactional messages are never gated by marketing rules** (safety is never a flag). Marketing needs consent (`growth.marketing_messaging` is launch-locked) and respects STOP and consent withdrawal on the next evaluation.
- Quiet hours are computed on the local calendar, correct on both Cairo offset-change nights (`quietUntil` with a zone, contracts 1.12.0).
- The gate is proved against an independent oracle (1280 vectors); decisions store counters and reason codes, no message text.

## Consequences
Provider messaging (SMS, WhatsApp) stays on mock adapters until the provider go-live pass; template copy and counsel review are human items.
