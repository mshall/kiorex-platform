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

## Partner leads and the onboarding funnel (front door, ADR-040 amendment)

The state-aware **Kiorex** tab of each product has a "Talk to us" form. A lead may come from an organisation that has no enrolment code yet, so it uses a **separate, low-privilege signed endpoint** (it can only create a lead or a counter marker; it cannot register, approve or read anything).

| Piece | Where |
|---|---|
| Tables `PartnerLead`, `PartnerFunnelMark` (migration `20261126120000_partner_leads`) | one lead per (kind, org); one marker per (kind, org, stage); contact details only, never PHI |
| Signed lead | `POST /api/v1/partners/v1/leads` (kind, orgRef, orgName, contactName, role, phone and/or e-mail, preferred time, note, consent `true`; strict shape, unknown fields refused, 4 KiB cap) |
| Funnel marker | `POST /api/v1/partners/v1/funnel` (kind, orgRef, stage `INTERESTED` or `STARTED`; idempotent) |
| Signing | same envelope as the intake: `X-Kiorly-Timestamp` + `X-Kiorly-Signature: sha256=HMAC(key, "<ts>.<rawBody>")`, key = `sha256hex(PARTNER_LEAD_SIGNING_SECRET)`, nonce replay protection. The secret is a deployment value shared with the products as `KIOREX_LEAD_SIGNING_SECRET`; outside production a fixed dev value is used, in production an unset secret means nothing authenticates. NEEDS_HUMAN: provision it per environment |
| Errors | 400 shape, 429 `RATE_LIMITED` + `Retry-After`, ONE uniform 401 `LEAD_UNAUTHORIZED` for every authentication failure |
| Rate limits (shared Postgres limiter) | per IP 10 leads / 60 markers per minute, per organisation 5 leads / 30 markers per hour, failed-auth block per IP (env `LEAD_RATE_*`) |
| Ops | `/partner-leads` in `apps/ops`; API `GET /admin/partner-leads` (`status`, `kind`), `PATCH /admin/partner-leads/:id` (status, assignee), `POST /admin/partner-leads/:id/notes`, `GET /admin/partner-leads/funnel?days=` |

**Lead status** is NEW, CONTACTED, STARTED, SUBMITTED, LIVE, CLOSED. Ops set it by hand (CONTACTED, CLOSED); STARTED, SUBMITTED and LIVE follow the organisation automatically (a wizard-started marker, then its connection request, then LIVE) and are never lowered. The row links to the onboarding request once one exists.

**Funnel** counts distinct organisations in the chosen period: interested (viewed the Kiorex tab while standalone, or clicked Talk to us), started the wizard, submitted (a connection request exists), live. A later stage implies the earlier ones, and the percentages are conversion from the previous stage and from interested. Products send only organisation id + product kind + stage; nothing else.

Gaps: markers rely on the products being online when the tab is viewed (best effort, never blocks the UI); the lead e-mail/WhatsApp notification to the Kiorex team is not built (ops read the page); the shared signing secret is deployment-wide, not per organisation.
