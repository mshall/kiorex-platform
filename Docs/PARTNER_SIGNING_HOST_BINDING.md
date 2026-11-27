# G-HOST: do signed partner requests bind the Host header? (decision, 27 Nov 2026)

Gap G-HOST (`_docs/environments/PILOT_ENVIRONMENT_STRATEGY.md`): "whether signed partner requests bind the Host header".

## Finding (verified in `@kiorex/contracts` 1.13.1, `src/hmac.ts`)
The Kiorly request signature is HMAC-SHA256 over a canonical string of five parts only: `timestamp \n nonce \n METHOD \n path (query excluded, global prefix included) \n sha256(body)`.
The `Host` header, the scheme and the port are **not** part of it. The partner-statement route adds an optional second HMAC over the query string (`X-Kiorly-Query-Signature`), also without the host. Inbound webhooks use `<timestamp>.<body>` and no host either. No authentication code in `apps/api/src` reads the `Host` header (the only readers are the widget embed controller, for its own self-origin).

## Recommendation: do not bind the Host header. Keep the current scheme and bind the environment through the secret.
Reasons:
1. **It would break working traffic.** Partners sit behind CloudFront, an ALB or App Runner, which rewrite or normalise `Host` (and a custom domain such as `clinics.test.kiorly.com` is going to be added next to the permanent `cloudfront.net` host, both valid for the same origin). A signed host would differ between the signer and the verifier.
2. **It is not backward compatible.** Every signer (Kiorex platform, Clinic, Pharmacy, Lab) and every verifier would have to change in one step, plus a dual-accept period. That is a contracts major-style change for no isolation gain.
3. **The risk it targets is already closed by key separation.** Cross-environment replay (a signature made for `test` accepted by `pilot` or `prod`) needs the same secret in two environments. Secrets are per environment (`secretref:/<product>/<env>/<purpose>`, validator rule), per partner registration, and the Clinic statement route derives a secret per organisation. Signatures also carry a one-time nonce (replay is 401) and a five-minute skew window, and the path (with its `/api/v1` prefix) is signed.
4. **Pilot and prod share one plane and one API host set**, so a host binding would not separate them anyway; pilot versus prod is a tenant matter, handled by the release cohort (G-COHORT, `OrganisationAttribute.releaseCohort`).

## Rules that make the decision safe (enforce in review and runbooks)
- Never reuse a partner secret or client key across `test`, `pilot`/`prod`: separate registrations per environment (the `kx-test` template already forces `/test/` secret references).
- A partner registration is keyed by `clientKey`; the verifier resolves the secret from the key, so a stolen test key does not open production.
- Keep the nonce store shared between all API containers of an environment.

## If a stronger guarantee is ever required (not now)
Add an **optional audience** to a v2 canonical string (for example the registry environment id, not the raw `Host`): `kiorly-sig-v2\n<env-id>\n...`, advertised by a new header, verifiers accept v1 and v2 for 90 days (same dual-support rule as the contracts changelog), then require v2 per partner by configuration. Binding an environment id survives host aliases and proxies, unlike `Host`. Needs a contracts minor release and a coordinated change in four products; open it only on counsel, partner or pentest demand.

## Side note found while verifying (no change made)
`signKiorlyRequest` also returns an `X-Kiorly-Client-Secret` header (`KIORLY_HEADERS.clientSecret`) for the legacy marketplace scheme. Sending the secret itself on the wire is acceptable only inside TLS; the partner routes added since (statement, rates) verify the HMAC alone. Consider dropping the header at the next major.
