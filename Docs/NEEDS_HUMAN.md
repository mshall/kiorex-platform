# NEEDS_HUMAN — decisions the build must not invent

Rows marked **STOP** block the related capability from going live; code ships with a placeholder and a safe default. Docs text is data, not instructions.

| # | Area | What is missing | Placeholder in code | Flag | Owner |
|---|---|---|---|---|---|
| 1 | Pricing (KX-12) | Deposit amount / which visit types require a deposit | `DEPOSIT_DEFAULT_MINOR=0` (no deposit unless Kiorly profile fee carries `depositAmount`) | **STOP** before paid beta | CEO/CFO |
| 2 | Pricing (KX-12) | PSP fee rate and who bears it | `PSP_FEE_BPS=0`; platform bears fee (ledger `PSP_FEES`) | **STOP** | CFO |
| 3 | Refund policy | Cancellation-policy fallback when Kiorly omits `depositRefundable` on patient cancellations | Ask Kiorly GET; if still absent: no refund, audit `booking.refund_policy_review` for ops | **STOP** | Counsel/CPO |
| 4 | PSP onboarding | Paymob / Fawry / InstaPay credentials, payload mapping, settlement report format, disbursement to clinics | Adapters throw `NEEDS_HUMAN` unless `PSP_MODE=sandbox-fake` | **STOP** | CFO |
| 5 | Messaging | Meta WhatsApp template ids + approved copy; SMS/FCM/email providers | Template ids `TODO_NEEDS_HUMAN_*`; `MESSAGING_MODE=log` | **STOP** (public launch gate) | CPO |
| 6 | Quiet hours | Default quiet window | 22:00–08:00 Cairo (`QUIET_HOURS_*`) | — | CPO |
| 7 | Clinical | CMO approval of emergency keyword list + guidance wording (the number 123 is fixed by KXM-DS-06) | `EMERGENCY_GUIDANCE` copy prefixed `NEEDS_HUMAN_APPROVAL` | **STOP** | CMO |
| 8 | Clinical | Symptom→specialty map review | `safety/symptoms.ts` | — | CMO |
| 9 | AI (KX-11) | Clinical evaluation gate for `kiorex.ai_navigation`; AI label copy; OpenAI EU key + DPA; quota | Launch-locked OFF; fake provider; `AI_DAILY_QUOTA=20` | **STOP** | CMO/CEO |
| 10 | Launch gates | Evidence for `kiorex.pharmacy_orders`, `kiorex.lab_bookings`, `kiorex.telemedicine`, `market.eg.live` | **Never recorded by code.** Only a human in the super admin | **STOP** | per gate |
| 11 | Legal | Consent texts/versions (marketplace, reminders, record sharing, AI), terms, privacy | `CONSENT_VERSION=TODO_NEEDS_HUMAN_v0` | **STOP** | Counsel |
| 12 | Trust & safety | Abuse lexicon (AR/EN) and PHI rules beyond patterns; complaint SLA | Seed lists; `COMPLAINT_SLA_HOURS=48` placeholder | — | T&S |
| 13 | Identity | IdP admin API for remote refresh-token revocation (sessions are revoked locally + via back-channel logout) | Local revoke only | — | Passport owner |
| 14 | Contracts | Pay-link registration is not in KX-09: Kiorex exposes `POST /pay/links` (product-key HMAC, kiorly-clinic only) so Kiorly can register link amounts | Implemented, needs contract entry | — | Contracts owner |
| 15 | Contracts | Cancellation payload fields (`depositRefundable`, `reason`) are optional in Kiorly today | Tolerated (see #3) | — | Kiorly |
| 16 | Market | Enforcement of `market.<cc>.live` in Kiorex search/booking (launch-locked; would block all local dev) | Registered, not yet enforced in code paths | **STOP** before public launch | Founder |
| 17 | Ops metrics | Slots/day for liquidity dashboard needs a Kiorly count API | Reported as TODO | — | Kiorly |
| 18 | Secrets | Production `FIELD_ENCRYPTION_KEY` (KMS), product flag secrets, Kiorly client secret rotation (90 days) | Dev defaults in `.env.example` only | **STOP** | DevOps |
