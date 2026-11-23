# Organization onboarding / data import (ops console)

Super admins onboard another organization by importing its legacy **SQL dump / CSV / XLSX** and its **patient files** into a quarantined batch. The platform scans, proposes a mapping and turns everything ambiguous into a task for a human. Nothing touches live clinical data until a **second super admin** approves. Mock providers only (CLAUDE.md): the commit target is `mock` until the Clinic receiver is built.

Code: `apps/api/src/onboarding-import/` (API) · `apps/ops/src/pages/Onboarding*.tsx` (console, route `/onboarding`, nav "Onboarding imports", AR/EN + RTL) · tests below. Sample data (100 % fake): `src/onboarding-import/sample/sample-data.ts` (`buildSample()`), used by unit, integration and e2e tests.

## Flow

| Step | What happens | Where |
|---|---|---|
| 1 Upload | Files go to the quarantine store (`StagingStore`, local FS now, S3 + SSE at go-live) as raw `application/octet-stream` (`POST …/files?name=`, ≤ 52 MB) or JSON base64. Magic-byte sniffing (extension/MIME never trusted), per-kind size limits (SQL 50 MB, tables 25 MB, patient files 15 MB), malware adapter (`MalwareScanner`, mock knows EICAR), PDF active content and CSV formula injection rejected. Rejected files become a `FILE_REJECTED` task; identical bytes become `DUPLICATE_FILE`. | `lib/file-scan.ts`, `adapters.ts` |
| 2 Scan | SQL is **parsed statically, never executed** (`lib/sql-parser.ts`: MySQL/Postgres/generic, `INSERT … VALUES`, `COPY … FROM stdin`, escapes, comments; DROP/GRANT/etc. are counted and reported, never run). CSV delimiter/BOM/encoding detection (UTF-8/16, windows-1256 fallback, double-encoding repair), XLSX via a bounded zip reader. | `lib/*` |
| 3 Map | Tables are classified to patients / appointments / visits / billing / documents and columns are matched (EN + AR synonyms, abbreviations like `pat_id`, `nat_no`). ≥ 0.85 confidence is applied silently, 0.6–0.85 raises `CONFIRM_MAPPING`, missing required fields raise `MAP_COLUMN_REQUIRED`, unknown tables `TABLE_UNCLASSIFIED`. | `lib/mapper.ts` |
| 4 Validate | Required fields, Egyptian phones (Arabic digits, `+20`), dates (ambiguous `03/04/1990` flagged, Excel serials), national-id checksum (century, birth date, governorate; derives dob/gender), gender words, mojibake, orphan references, duplicates (same national id, or same phone + name key with Arabic folding). | `lib/analyzer.ts`, `lib/normalize.ts` |
| 5 Match files | Patient files ↔ patients by documents table row, national id, phone, patient id (`P1001_…`), then name. Unique id/nid/phone ⇒ auto; name/id only ⇒ `CONFIRM_FILE_MATCH`; several candidates ⇒ `AMBIGUOUS_FILE`; none ⇒ `ORPHAN_FILE`. Never silently guesses. | `lib/analyzer.ts` |
| 6 Resolve | Resolution queue in the console. Actions: map column/table, edit value, merge / keep both / skip duplicate, assign patient or file, repair encoding, choose date format, skip row/file, ignore **with a mandatory reason**. Blockers must be resolved; warnings may be ignored. | `OnboardingBatchPage.tsx` |
| 7 Dry-run | Counts per entity, files to attach, merged patients, open warnings, ignored-with-reason, and a **report hash** (sha256 of the canonical records). | `GET …/dry-run` |
| 8 Two-person commit | `request-commit` (ops_admin or super_admin) → `approve` (**super_admin only, ≠ requester, ≠ creator**, must present the report hash) → `commit` (super_admin). Any data-changing decision after the request voids it (hash mismatch → back to READY). | service |
| 9 Commit | Entity order patients → appointments → visits → billing → documents, chunked, each item carries `imp:<batch>:<entity>:<sourceKey>` as idempotency key; `ImportCommitItem` is unique on it. A crash leaves `COMMIT_FAILED`; `commit` again resumes without duplicates. | service |
| 10 Rollback | `rollback` (super_admin, reason) asks the target to remove everything tagged with the batch, marks items `ROLLED_BACK`. `purge-staging` deletes blobs and parsed rows afterwards. | service |

State machine: `DRAFT → NEEDS_REVIEW ⇄ READY → AWAITING_APPROVAL → APPROVED → COMMITTING → COMMITTED | COMMIT_FAILED → …`, `COMMITTED|COMMIT_FAILED → ROLLING_BACK → ROLLED_BACK`. Uploads and decisions are locked once committing starts.

## Design rules

* **Deterministic analysis.** `analyze()` is a pure function of (parsed tables, staged files, decisions). Every UI action stores a decision keyed by a stable task key and re-runs it, so the queue is idempotent and a re-scan after new uploads keeps earlier decisions. Resolved tasks that no longer occur stay as history.
* **PHI.** Rows and files live only in the staging tables/blobs (`ImportFile.tables`, `ImportTask.payload`). Logs carry ids, sizes, kinds and codes only; the audit log (`onboarding.*` actions) carries counts and task types, never values or file names. Task contexts shown to ops mask names/phones in duplicate lists. Tests assert that known sample names, phones, national ids and file names never reach logs or audit.
* **Audit.** batch_created, file_staged/rejected, task_resolved, commit_requested/approved/rejected/started/resumed/failed/completed, rollback_started/completed/failed, staging_purged.
* **No live-table writes in the platform.** The platform is not a clinical system of record (ADR-005). Records go to the Clinic through `ImportTarget`: `mock` (default, `IMPORT_TARGET_MODE=mock`) or `kiorly` (HMAC, below).

## API (ops-only, `/api/v1/admin/onboarding/imports`)

`POST /` create · `GET /` list · `GET /:id` · `POST /:id/files` · `POST /:id/rescan` · `GET /:id/tasks?status&severity&type&page` · `POST /:id/tasks/:taskId/resolve` · `POST /:id/tasks/resolve-many` · `GET /:id/patients?q` (assign picker) · `GET /:id/dry-run` · `POST /:id/request-commit` · super-admin: `approve` `reject` `commit` `rollback` `purge-staging` · `GET /:id/audit`. Errors are `{code, message}` with stable codes (`TWO_PERSON_RULE`, `BLOCKERS_OPEN`, `REPORT_CHANGED`, `COMMIT_FAILED_RESUMABLE`, `IGNORE_REASON_REQUIRED`, …) which the console localizes.

## Clinic contract (draft, additive, NOT yet implemented on the Clinic side)

`POST /marketplace/v1/imports/{batchId}/records` body `{ orgId, entity, items:[{ idempotencyKey, sourceKey, data, file?:{name,contentBase64} }] }` → `{ results:[{ sourceKey, targetId }] }` (idempotent per item key, 409 on key reuse with different payload) and `POST /marketplace/v1/imports/{batchId}/rollback {orgId}` → `{ removed }`. The Clinic must tag every created row with `importBatchId`, resolve `data.patientTargetId` for child entities, allocate MRNs itself, de-duplicate against patients that already exist in the tenant, and store documents through its ADR-036 storage pipeline (KEEP ≤ 4 MB, REDUCE ladder above). Client side is in `KiorlyClient.importRecords/importRollback` + `KiorlyImportTarget`. See `kiorex-contracts/docs/ORG_IMPORT.md`.

## Tests

* Unit: `apps/api/src/onboarding-import/lib/onboarding-lib.unit.spec.ts` (parsers, encoding, normalisation, scan, analyzer).
* Integration: `apps/api/test/onboarding-import.int.spec.ts` (roles, quarantine, full flow, two-person rule, crash + resume, idempotency, rollback, PHI-free logs/audit).
* Console: `apps/ops/src/__tests__/onboarding.test.tsx` (vitest) and `apps/ops/e2e/onboarding.spec.ts` (Playwright, real Passport: ops_admin prepares, super admin approves/commits/rolls back, 20 files, Arabic RTL).
* Cross-service: `e2e/test/19-org-onboarding.e2e.ts` (live API, real tokens).
* Manual demo: log in as the ops super admin, open **Onboarding imports**, create a batch, upload the files that `buildSample()` produces (write them with the snippet in the e2e spec).

## Go-live (NEEDS_HUMAN, provider pass)

Real malware scanning (ClamAV / GuardDuty Malware Protection for S3) behind `MalwareScanner`; S3 staging bucket behind `StagingStore` (private, SSE, lifecycle expiry ≤ 30 days, tofu); the Clinic receiver above; retention period for staged PHI and a DPA/consent basis for importing another organization's patients (counsel); a launch flag (`ops.org_import`) would need a `@kiorex/contracts` FLAG_KEYS bump, so it is deliberately not added here.
