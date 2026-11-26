# Partner settlement statement: credential and query-signature hardening (platform done, products to follow)

Route: `GET /api/v1/partner/commissions/settlement-statement` and `/export` (platform, LG-COM-19). The platform side is built and tested locally and stays backward compatible: nothing below is required of the products until a deployer switches the modes to the strict values. The Clinic, Pharmacy and Lab clients live in other repositories (not changed here).

## 1. Per-organisation Clinic credentials (platform)

| Setting (platform API env) | Default | Meaning |
|---|---|---|
| `COMMISSION_STATEMENT_ORG_KEY_MASTER` | unset | At least 16 characters, secret by reference. A Clinic tenant's signing secret is `hex(HMAC-SHA256(master, "kiorex-statement-org-v1\|" + orgRef))`. The master never leaves Kiorex; only the per-tenant value is handed to a tenant. Unset = no derived credentials. |
| `COMMISSION_STATEMENT_ORG_SECRETS` | unset | JSON `{"<orgRef>": "<secret, 16+ chars>"}`. Pins one tenant's secret (wins over the derived one), for rotation of a single tenant. Invalid JSON is ignored. |
| `COMMISSION_STATEMENT_CLINIC_AUTH` | `either` | `either`: the tenant's own secret or the old shared Clinic secret verify (current behaviour keeps working). `per_org`: the shared secret is refused (a Clinic with no configured credential gets 401). `shared`: only the old behaviour. |

Provisioning (operator, outside the repo): derive the per-tenant secret with the master and place it in the Clinic's per-tenant settings (or one secret per tenant), then switch to `per_org` once every tenant has one. The key to sign with is chosen from `X-Kiorly-Org-Ref`, so a tenant's secret can only ever open its own statement; naming another tenant fails the signature (401). Audit rows of reads and exports now carry `credential` (`ORG`, `SHARED`, `REGISTRATION`).

Clinic client change needed (`clinics-management/apps/api/src/kiorex/commission-statement.ts`, `commission-collections.service.ts`): sign with the per-tenant secret (new env or tenant setting, for example `KIOREX_STATEMENT_ORG_SECRET`) instead of `KIOREX_OUTBOX_WEBHOOK_SECRET` when it is set; keep `X-Kiorly-Client-Key` and `X-Kiorly-Org-Ref` as today. Pharmacy and Lab already sign with their own registered secret: no change for this item.

## 2. Signed query string (platform)

The contract request HMAC covers method, path (query stripped) and body hash. A second HMAC now covers the query string:

- Header `X-Kiorly-Query-Signature` = base64url(HMAC-SHA256(secret, canonical)), the same secret that signs the request.
- `canonical` = `"kiorly-query-v1\n" + timestamp + "\n" + nonce + "\n" + METHOD + "\n" + path + "\n" + canonicalQuery`, with `timestamp` and `nonce` the values of `X-Kiorly-Timestamp` and `X-Kiorly-Nonce` of the same request (so it cannot be moved to another request) and `path` without the query (for example `/api/v1/partner/commissions/settlement-statement`).
- `canonicalQuery` = every `key=value` pair, key and value percent-encoded with `encodeURIComponent`, sorted by key then value, joined with `&`; no query = empty string. Client order does not matter.
- `COMMISSION_STATEMENT_QUERY_SIGNATURE`: `optional` (default: a present signature must verify, 401 otherwise; an absent one is accepted) or `required` (401 without a valid signature, even with an empty query).

Reference implementation: `apps/api/src/commissions/commission-partner-signing.ts` (`canonicalQuery`, `signStatementQuery`), unit tests in `commission-partner-statement.unit.spec.ts`.

Client changes needed, three files with the same one-line addition after the existing contract signature is built (the headers returned by `signKiorlyRequest`):
- `clinics-management/apps/api/src/kiorex/commission-statement.ts`
- `kiorly-pharmacy/apps/api/src/modules/growth/commission-statement.ts`
- `kiorly-lab/apps/api/src/modules/growth/commission-statement.ts`

```ts
// after: const s = signKiorlyRequest({ clientKey, clientSecret: <the signing secret>, method: 'GET', path, ... });
import { createHmac } from 'node:crypto';
const cq = [...new URLSearchParams(queryString)].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
  .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
const canonical = `kiorly-query-v1\n${s.timestamp}\n${s.nonce}\nGET\n${path}\n${cq}`;
headers['X-Kiorly-Query-Signature'] = createHmac('sha256', signingSecret).update(canonical).digest('base64url');
```

Order of rollout: products send the header first (accepted while `optional`), then the deployer sets `required`; for the Clinic, per-tenant secrets first, then `per_org`. Both are env changes on the platform only; no deploy was done and none is implied by this document.
