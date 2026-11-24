# ADR-050: Referral qualification and fraud safeguards (rewards never alter attribution)

- Status: **PROPOSED** (not signed; patient referral is counsel-gated, launch guide 11.34). Packages GRW-P2-B1, GRW-P2-B2, GRW-P3-D (shadow scoring).

## Context
Patient referral lowers acquisition cost but invites farming, self-referral and collusion with staff, and a reward must not become a way to change who is charged a commission.

## Decision
- A reward is issued only after the referee's **first attended visit and the refund window**, by a pure `qualify()` (16 checks) inside a row-locked service: exactly one `ReferralQualified`, idempotent issue keys, one refusal shape and no oracle for an unknown or suspended code.
- **Rewards never alter attribution.** A referral touch is marketplace evidence (reason `PATIENT_REFERRAL`); no reward, coupon or credit changes an acquisition origin, a commission decision or a charge. A downstream order never creates a reward.
- Eight pure fraud rules (hashes only, no raw identifiers) run in enforce or shadow mode (`growth.referral_fraud_enforce`: ON enforces; OFF is shadow). Holds and a two-person override for reviewers; recoverable loss on reversal.
- Safety controls (k-anonymity floor, consent check on marketing, PHI guard) are never flags.

## Consequences
The Clinic staff-phone-match endpoint, a payment fingerprint and a chargeback webhook have no live feed yet (launch guide 11.35, 11.36); the reward numbers are all zero until the founder sets them (11.32).
