# Phase 2/3 verticals and records — design notes

Launch-locked flags (`kiorex.pharmacy_orders`, `kiorex.lab_bookings`, `kiorex.telemedicine`) ship **ON** but are effective only after a human records gate evidence in the super admin (ADR-024). Application code never records a gate; dev seed and the test harness insert clearly labelled DEV rows only for `market.eg.live`. Take rates are NEEDS_HUMAN config (0 while unset): `PHARMACY_TAKE_RATE_BPS`, `LAB_TAKE_RATE_BPS`, `TELE_CONSULT_FEE_MINOR`.

OFF semantics (ADR-023): new actions answer `403 FEATURE_DISABLED {key, scope}`; the patient's existing orders/bookings/sessions stay readable, cancellable and (for telemedicine) joinable. Emergency routing is a safety control, never a flag.

## Kiorly Pharmacy (real service; contract kiorex-contracts 1.4.1 `kiorly-pharmacy.v1.openapi.json`)

Client: `src/pharmacy/pharmacy.client.ts`; connection from the `PartnerRegistry` (table `PartnerRegistration`, ops-editable at `/admin/partners`; env fallback `KIORLY_PHARMACY_BASE_URL` = HOST only, default `http://localhost:3100`, `KIORLY_PHARMACY_CLIENT_KEY/SECRET`, `KIORLY_PHARMACY_WEBHOOK_SECRET`). Path prefix `/marketplace/v1`; the client key addresses the pharmacy tenant (no org header). See workspace INTEGRATION.md.

| Call | Purpose (KX-06) |
|---|---|
| `GET /pharmacies` | Branches that opted into Kiorex orders, delivery options and fee (KPMKT01) |
| `GET /catalogue?q&pharmacyId` | Items with availability-to-promise (KPINV07). Controlled medicines are never returned (KPRX05); Kiorex also filters defensively |
| `POST /catalogue/quote` | Authoritative price/availability/delivery fee for a cart; Kiorex never trusts client prices |
| `POST /orders` (Idempotency-Key = Kiorex order id) | Created **after** payment capture; body `{orderRef, pharmacyId, patientRef, items[{sku,qty}], delivery, prescription?{recordRef, verificationToken}, payment{reference,totalMinor}}`; answer `ACCEPTED \| PENDING_VALIDATION \| REJECTED` |
| `POST /prescriptions/validate` | Rx validation request (KPMKT04) with the QR token; answer `VALID \| INVALID \| PENDING`. The pharmacy verifies the token with `GET /rx/verify?t=` |
| `POST /orders/{id}/cancel` | Patient cancel before preparation |

Events to `POST /webhooks/pharmacy` (same signature scheme as Kiorly Clinic, eventId de-dup): `OrderReady`, `DispenseCompleted` (pharmacist sign-off mandatory, `partial` => `PARTIAL_REVIEW`, no auto-release), `OrderRejected` (full automatic refund).

Flow: cart (`PUT /pharmacy/cart`, one pharmacy per cart) -> delivery choice (`PUT /pharmacy/cart/delivery`) -> `POST /pharmacy/orders` (order intent + Kiorex Pay checkout) -> PSP capture -> outbox `pay.order_captured` -> `POST /orders` (+ Rx validation) -> `OrderReady` -> `DispenseCompleted`. Partner outage after payment: order stays `PAID`; the outbox retries with the same Idempotency-Key; `POST /admin/pharmacy/orders/{id}/resubmit` after DEAD.

## Kiorly Lab (real service; contract `kiorly-lab.v1.openapi.json`)

Client: `src/lab/lab.client.ts`; registry as above (env fallback `KIORLY_LAB_BASE_URL` host only, default `http://localhost:3200`; key `kl_dev_kiorex`), path prefix `/api/v1/integration/v1`; the order is idempotent on `sourceRef` = booking id and cancel is `POST /orders/{sourceRef}/cancel`. Calls: `GET /tests`, `POST /tests/quote`, `GET /labs/{id}/slots?collectionType=HOME|WALK_IN`, `POST /orders` (Idempotency-Key = booking id), `POST /orders/{id}/cancel`. Result: `LabResultReleased` to `POST /webhooks/lab` -> vault `LAB_RESULT` (signed secure link only, never values, KLCRIT03) when the report channels include `KIOREX_VAULT` and the patient has not revoked `LAB_RESULTS`; funds release on result release.

## Money (Kiorex Pay ledger; three ledgers never commingled)

Vertical payments are `PaymentIntent.purpose = PHARMACY | LAB` with `orderRef`; they never call Kiorly clinic `deposit-paid` and never enter clinic payouts. Accounts: capture `PSP_CLEARING -> HELD:ph:<id>|lab:<id>`; fulfilment `HELD -> PAYABLE:<partner>` minus the take into `MARKETPLACE_FEES`; refund `HELD -> REFUND_PAYABLE -> PSP_CLEARING`. Idempotency keys: `capture:`, `release-order:`, `refund-order:`. Own fee statement: `GET /admin/fee-statements` (VAT is a config line, `FEE_STATEMENT_VAT_BPS`). **No tax-authority reporting of any kind** (`no-tax-authority.unit.spec.ts` guards the source).

## Telemedicine

Matching (`GET /telemedicine/providers`) + session orchestration (`POST /telemedicine/sessions` for a CONFIRMED booking; join window opens 15 min before; patient `join`; Kiorly Clinic `POST /telemedicine/clinician/bookings/{bookingId}/token|end` with product-key HMAC). Video provider behind `VideoAdapter` (`VIDEO_MODE=mock` issues fake tokens). Only session metadata is stored; the clinical record stays in Kiorly Clinic.

## Records & continuity (KXM-RC-01..03)

Kiorly -> Kiorex events (KX-11): `VISIT_SUMMARY_SHARED` (HMAC `KIOREX_RECORD_SHARE_HMAC_SECRET` over `JSON.stringify(summary)` verified), `PRESCRIPTION_SHARED`, `RECORD_SHARE_REVOKED` (delete copies), `LabResultReleased`. Clinical content is AES-GCM encrypted at rest, stripped from webhook receipts, never logged or sent to analytics. Patient consent per scope: `PUT /me/record-sharing/{scope}` (grant needs `kiorex.record_vault` + `clinic.record_share_patient_app`; revoke always works, deletes Kiorex copies and mirrors to Kiorly via outbox `POST /patients/{id}/consents`). Prescription QR: opaque HMAC token (`kxrx1.<recordId>.<mac>`), public `GET /rx/verify?t=` returns validity + clinic id + signed date only.

## Waitlist (BK-12) and WhatsApp (BK-11)

See NEEDS_HUMAN #19/#20: Kiorex-side waitlist (slots API + `SLOTS_CHANGED`, honours `clinic.waitlist_autofill`) and a WhatsApp conversation state machine (`IDLE -> CHOOSE_SPECIALTY -> CHOOSE_DOCTOR -> CHOOSE_SLOT -> CONFIRM`, waitlist offer when no slots) over the same BookingService. Emergency language interrupts any step with the 123 guidance.
