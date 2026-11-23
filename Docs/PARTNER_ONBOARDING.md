# Partner onboarding (ops console), ADR-040

Kiorex ops connect standalone clinics, nurses, pharmacies and labs through **Partner onboarding** (`/partner-onboarding` in `apps/ops`, API `apps/api/src/partner-onboarding`).

| Piece | Where |
|---|---|
| Table `PartnerConnection` (PHI-free, secrets encrypted and wiped at Go live) | `prisma/migrations/20261124170000_partner_connections` |
| Signed intake + status poll | `POST/GET /api/v1/partners/v1/connection-requests` (public; HMAC `ts.rawBody`) |
| Ops API | `/api/v1/admin/onboarding/partners` (ops_admin prepares; approve is super_admin only) |
| Step model (pure, unit tested) | `partner-onboarding/steps.ts` |

**Automated (idempotent, re-run with one click):** credentials, signed handshake (pharmacy `GET /catalogue`, lab `GET /tests`, clinic `GET /marketplace/v1/connection/:orgRef`), catalogue/provider dry-run counts, flags and launch-gate evidence, market/pack, duplicates (client key, existing providers, same name), required documents and terms.
**Human (highlighted):** review documents, verify licence (reference required), confirm fees (an organisation override is set on the Policy page, never invented here), launch-gate evidence for `kiorex.pharmacy_orders` / `kiorex.lab_bookings` (recorded only through the human super-admin gate route), approval (a different super admin than the requester and the licence verifier), Go live.
**Go live** needs every step green; it activates the registry entry (pharmacy/lab), ensures the partner's org-scope flags are ON, tells Clinic over the signed marketplace API and notifies the partner through the mock notification layer. Pause, resume, request changes and reject require a reason. Credential rotation is applied only after a passing handshake.

Gaps: the registry still routes outbound calls to the first active registration of a kind (several live partners of one kind need routing per order); the intake is not yet in the published OpenAPI; real notifications, counsel-approved wording and real gate evidence are NEEDS_HUMAN.
