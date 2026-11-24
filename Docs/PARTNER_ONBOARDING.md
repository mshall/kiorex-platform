# Partner onboarding (ops console), ADR-040

Kiorex ops connect standalone clinics, nurses, pharmacies and labs through **Partner onboarding** (`/partner-onboarding` in `apps/ops`, API `apps/api/src/partner-onboarding`).

| Piece | Where |
|---|---|
| Table `PartnerConnection` (PHI-free, secrets encrypted and wiped at Go live) | `prisma/migrations/20261124170000_partner_connections` |
| Signed intake + status poll | `POST/GET /api/v1/partners/v1/connection-requests` (public; published in contracts 1.9.0; one-time enrolment code for the first request, issued intake key afterwards; replay-protected, rate limited, 64 KiB cap, uniform 401) |
| Enrolment codes | `/api/v1/admin/onboarding/enrolments` (ops: create / list / revoke) and the "Enrolment codes" panel on `/partner-onboarding`; table `PartnerEnrolment` (migration `20261125090000_partner_intake_enrolment`) |
| Ops API | `/api/v1/admin/onboarding/partners` (ops_admin prepares; approve is super_admin only) |
| Step model (pure, unit tested) | `partner-onboarding/steps.ts` |

**Automated (idempotent, re-run with one click):** credentials, signed handshake (pharmacy `GET /catalogue`, lab `GET /tests`, clinic `GET /marketplace/v1/connection/:orgRef`), catalogue/provider dry-run counts, flags and launch-gate evidence, market/pack, duplicates (client key, existing providers, same name), required documents and terms.
**Human (highlighted):** review documents, verify licence (reference required), confirm fees (an organisation override is set on the Policy page, never invented here), launch-gate evidence for `kiorex.pharmacy_orders` / `kiorex.lab_bookings` (recorded only through the human super-admin gate route), approval (a different super admin than the requester and the licence verifier), Go live.
**Go live** needs every step green; it activates the registry entry (pharmacy/lab), ensures the partner's org-scope flags are ON, tells Clinic over the signed marketplace API and notifies the partner through the mock notification layer. Pause, resume, request changes and reject require a reason. Credential rotation is applied only after a passing handshake.

**Enrolment code (how a partner starts).** Ops create a code for the partner (product, a label, optionally the organisation id it is bound to, validity 1 to 14 days), hand it over through a trusted channel, and the owner pastes it into the "Request to go live" step of Connect to Kiorex. It is shown once, works once, expires, can be revoked while unused, and every step is audited without the code. The first request is signed with it; Kiorex answers with an intake key that signs later requests. Details and error codes: INTEGRATION.md and `kiorex-contracts` 1.9.0.

**Several live partners of one kind.** Outbound pharmacy and lab calls are routed per registration (see INTEGRATION.md, "Several live partners of one kind"): carts, orders and bookings carry `registrationId`, existing rows were backfilled to the single registration that served them, webhooks only move the owning registration's orders, the ops Orders page shows the owning partner, and org-scope flags `pharmacy.kiorex_orders` / `lab.kiorex_bookings` switch one partner off without touching the others.

Gaps: the intake rate limits are per API instance (put the WAF in front for a global cap); `LAB_NURSE` (Kiorly Nurse relay, outbound only) still resolves to the first active registration of that kind; Kiorex has no poll of the partner for dispense status (progress arrives by signed webhook, reconciliation covers money only); real notifications, counsel-approved wording and real gate evidence are NEEDS_HUMAN.
