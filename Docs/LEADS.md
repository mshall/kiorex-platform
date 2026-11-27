# Join requests (leads) from the Kiorly site

Added 28 Nov 2026. Module `apps/api/src/leads/`, Ops pages `apps/ops/src/pages/SiteLead*.tsx`, site `kiorex-account/apps/kiorly-site`. Mock messaging only; nothing here is a price, a fee or legal wording.

## What it is
A provider (clinic, independent doctor, chain, hospital, nurse, physician, lab, pharmacy, other) fills the multi-step "Join us" form on the Kiorly site and chooses **Standalone** or **Standalone and connected to Kiorex**. The platform stores a *lead*, the Kiorex ops team (and the Kiorly admin edition) works it through a pipeline. This is separate from `partner-leads` ("Talk to us" signed by a Kiorly product for an existing organisation).

## Public API (no credentials)
| Route | Notes |
|---|---|
| `GET /api/v1/public/leads/config` | active picklists (provider types, specialties, modules, go-live, contact channels and times, markets with governorates), required fields, fields per provider type. `Cache-Control: public, max-age=60` |
| `POST /api/v1/public/leads` | JSON body (16 KiB limit enforced while streaming, 413 otherwise). **`Idempotency-Key` header (8 to 64 of `A-Za-z0-9_-`) is required.** 201 `{ reference: "KL-XXXXXXXX", status: "RECEIVED", replayed }`; same key and same body returns the same reference (`replayed: true`); same key, different body: 409 `IDEMPOTENCY_KEY_REUSED`; 400 `VALIDATION_FAILED { fields: { name: required|invalid|too_long|too_short|too_many|not_allowed } }`; 429 `RATE_LIMITED { retryAfterSec }` |

Abuse control (no CAPTCHA, none is used or bypassed): hidden honeypot field `website` (a filled one answers like a success and stores nothing), strict validation (unknown fields are refused), 16 KiB body, rate limits shared by every instance through the Postgres limiter: per IP 6 per 10 minutes (`LEADS_RATE_IP_PER_10MIN`) and 20 per day (`LEADS_RATE_IP_PER_DAY`), per phone 3 per day (`LEADS_RATE_PHONE_PER_DAY`), invalid input 30 per 10 minutes per IP (`LEADS_RATE_INVALID_PER_10MIN`), global 300 per hour (`LEADS_RATE_GLOBAL_PER_HOUR`). The client IP is `req.ip` (`TRUSTED_PROXY_HOPS`); only a keyed hash of it is stored. CORS: route-scoped (`leads/leads-cors.ts`): the site origin comes from `LEADS_PUBLIC_ORIGINS`, generated from the URL registry (`kiorex.api` env `LEADS_PUBLIC_ORIGINS: {url:kiorly.marketing}`); it is deliberately NOT added to the API-wide `CORS_ORIGINS`. A preflight is answered with 204 for any origin, allow headers only for allowed origins, no credentials. Note: on the kx-test host the secret bag `/kx/test/platform` carries its own `CORS_ORIGINS` line that is rendered AFTER the registry file and wins; a registry change to that list does not reach the container until the bag key is changed or removed (a founder-gated secret edit), which is why the site does not depend on it.

## Data and privacy
- Encrypted at rest (AES-256-GCM, `common/crypto` field key, same as national IDs): contact name, phone, e-mail, licence numbers (facility licence, professional licence, commercial register, tax card: self-declared, optional, **never validated against any authority**), applicant note. Phone and e-mail also carry a keyed blind index (`phoneHash`, `emailHash`) for duplicate detection and search.
- Plain (business, not personal): legal and trade name, provider type, mode, market, governorate, city, counts, specialties, modules, preferences.
- No contact details in logs, audit rows or trail events (they carry ids, statuses and counts). Reading a detail is audited (`lead.viewed`). A CSV export contains decrypted details and is audited (`lead.exported`, row count and filters, never the data).
- Consent: checkbox with a text **version** (`draft-2`) stored with the request and the time. The wording is a DRAFT pending counsel (TODO_NEEDS_HUMAN, `kiorex-account/apps/kiorly-site/src/form-text.ts`).

## Lifecycle
`NEW -> CONTACTED -> QUALIFIED -> ONBOARDING -> WON`, `LOST` from any open state (optional reason from a picklist), reopen paths (`LOST -> NEW`, `WON -> ONBOARDING`, `CONTACTED -> NEW`, ...). Allowed transitions are in `lead-config.ts` (`LEAD_TRANSITIONS`); anything else is 409 `INVALID_TRANSITION`. Owner assignment to a known console user (`OpsStaffContact`), tags, internal notes and a per-lead trail (`LeadEvent`: CREATED, STATUS, ASSIGN, NOTE, TAG, DUPLICATE, NOTIFY) plus `AuditLog` rows.

## Duplicates
Same phone or same e-mail as an earlier request (same test-data class): the new request is stored, tagged `duplicate`, linked (`duplicateOfId` = the first one) and the first one gets a DUPLICATE event. The applicant sees nothing different. Ops filter "duplicates only".

## Test and demo data
A request is tagged `isTest` when its e-mail is on a reserved domain or its name starts with a marker (defaults `example.test`, `example.invalid`, `kiorly-e2e.invalid`, prefix `[TEST]`, editable in the settings). Test requests send no notification, are excluded from the counters and can be filtered. A super admin removes all of them in one step (Settings > Test data markers: **count first, then delete**; `POST /admin/leads/test/remove`). `Lead`/`LeadEvent` are also targets of `demo-data:remove` (`isTest = true`).

## Notifications (mock by default)
`LeadNotifier` uses the shared `MessagingHub`: an acknowledgement e-mail to the applicant (only if they gave an address, language of the request) and an e-mail alert to console users who opted in to lead alerts (their own consent and channel, same as partner leads). Template ids are `TODO_NEEDS_HUMAN_site_lead_ack` and `..._team_alert`; the bodies carry the reference and type only. Switches in the settings (`notifications`). Real e-mail is the provider go-live pass, not this module.

## Admin API (roles `ops_admin`, `super_admin`; the Kiorly admin edition uses the same API and roles)
`GET /admin/leads` (filters `status type market mode from to q owner test duplicates page pageSize`), `GET /summary`, `GET /owners`, `GET /:id`, `PATCH /:id` (`status lostReason ownerSub addTags removeTags isTest`; `isTest` super admin only), `POST /:id/notes`, `GET /export.csv` (BOM for Excel, formula-injection safe, max 5000 rows), `GET /settings`, `PUT /settings` (super admin), `POST /test/remove` (super admin).

## Settings (configurable, not hard-coded)
Stored as one versioned document (`LeadSetting` key `config`): provider types, specialties, modules, go-live, current-software suggestions, contact channels and times, lost reasons, markets with dial code and governorates, status names (the six statuses themselves are fixed), required optional fields, test markers, notification switches. Defaults live in `lead-config.ts`; a fresh database serves them. Rules: keys are `A-Z0-9_`, never reused (deactivate instead of delete), AR and EN names for every option, at least one active type, module and market. Optimistic concurrency (`version`, 409 `LEAD_CONFIG_STALE`). **Maker-checker is not applied on purpose**: the repo's two-person pattern guards money and policy (commission, flags with gates); these picklists have no money, legal or safety effect. Every save is versioned and audited (`lead.config_changed` with the changed sections only). Super admin saves; ops reads.

The site fetches the live configuration at load (and keeps `kiorex-account/apps/kiorly-site/src/form-defaults.json` as its offline default; regenerate it with `npx ts-node --transpile-only scripts/emit-lead-form-defaults.ts`).

## Roles in the two consoles
Today the Kiorly admin and the Kiorex super admin share the same Passport roles (`ops_admin`, `super_admin`), so "Kiorly ops" and "Kiorly super admin" are the same accounts as the Kiorex ones. A Kiorly-only role split is a Passport and API change (see `KIORLY_ADMIN.md` Open).

## After a lead arrives: what exists and what is missing (traced 28 Nov 2026, verified live on kx-test by `e2e/kx-test/tests/10b-site-leads-matrix.spec.ts`)

**Who sees it.** Every join request goes to ONE inbox, `Lead`, in the Kiorex platform database, and is shown in the two Ops console editions (Kiorex admin and Kiorly admin: the same build, the same API `/api/v1/admin/leads`). There is no separate Kiorly store and no routing: the roles are `ops_admin` and `super_admin` on both hosts, so "Kiorly ops" and "Kiorly super admin" are the same Passport accounts as the Kiorex ones (a Kiorly-only role is not built).

| Action | ops_admin | super_admin |
|---|---|---|
| list (phone masked, e-mail not in the list), detail (decrypted, every read audited `lead.viewed`) | yes | yes |
| change status, assign owner, tags, internal notes | yes | yes |
| CSV export (decrypted, audited `lead.exported`) | yes | yes |
| read settings | yes | yes |
| save settings, remove test data, flip the test tag | no (403) | yes |

**Interest types.** `mode` is `STANDALONE` (a Kiorly module on its own) or `CONNECTED` (module and Kiorex); `modules` says which Kiorly products (Clinic, Pharmacy, Lab, Nurse, staff app, hospitals and chains). Provider types: Clinic, Independent doctor, Chain, Hospital, Nurse, Physician, Laboratory, Pharmacy, Other, each with its own questions. One market is configured (Egypt); the market is stored and filterable, and nothing is routed or owned by market.

**Notifications.** Real e-mail and WhatsApp are not configured (messaging hub in mock mode). On a new real lead the applicant gets an acknowledgement e-mail (mock) if they gave an address, and each console user who is an active alert recipient (switched on in Partner leads, "Alert recipients", with an e-mail address and the e-mail channel) gets a team e-mail (mock). A test lead sends nothing. Nobody is notified when a lead changes status, is assigned, or sits unattended: there is no assignment rule, no owner by default, no SLA or reminder.

**Starting the onboarding.** Status `ONBOARDING` and `WON` are labels only: they trigger nothing and create nothing. There was no link from a lead to the organisation onboarding flows. Those flows are: Partner onboarding (a one-time enrolment code is created by ops for a Clinic, Nurse, Pharmacy or Lab product; the partner product then submits a signed connection request; ops check, a super admin approves, go-live) and Organisation onboarding (data import batches). A standalone Clinic organisation is created inside the Clinic itself (public signup, a WhatsApp code) and has nothing to do with Kiorex.
Added 28 Nov 2026 (read-only, creates nothing): on the lead detail of a **connected** request that is **Qualified or Onboarding**, **Start onboarding** opens Partner onboarding with the kind (Clinic for Clinic, Doctor, Chain, Hospital, Physician; Nurse; Lab; Pharmacy; none for Other) and the label (legal name) filled. Only the request id travels in the URL. A standalone request shows an explanation instead (it has no Kiorex connection to prepare).
Still a founder decision (not built): WON creating an onboarding request draft or an enrolment code automatically; a default or round-robin owner; an SLA timer and reminder for NEW requests; notifying the owner on assignment; a Kiorly-only role split; per-market routing once a second market launches.

## Tests
`apps/api/src/leads/leads.unit.spec.ts` (validation, config, CSV), `apps/api/test/leads.int.spec.ts` (15 integration tests: intake, encryption at rest, idempotency incl. a race, rate limits, honeypot, size, duplicates, test data, access, filters, lifecycle, audit, CSV, settings, notifications), `apps/ops/src/__tests__/site-leads.test.tsx`, `apps/ops/e2e/site-leads.spec.ts` (`playwright.leads.config.ts`, both editions, EN and AR, axe), site tests in `kiorex-account/apps/kiorly-site`, and the deployed `e2e/kx-test/tests/10-site-leads.spec.ts`.

## Open (NEEDS_HUMAN)
Consent wording and privacy policy (counsel); copy review EN and AR; plan names, features and prices (the site shows marked placeholders); response-time promise on the success screen; whether a lead should create a partner onboarding request automatically when it becomes WON (product decision, not built); real e-mail templates; retention period for leads (counsel); a Kiorly-only role split.
