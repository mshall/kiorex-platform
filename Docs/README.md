# Kiorex platform — Docs hub

Product docs, runbooks and engineering rules for `kiorex-platform` (Kiorex marketplace API, patient web, ops console, mobile app).
Reference documents KX-00…KX-22 live in the workspace folder `_docs/` (read `CLAUDE.md` and `INTEGRATION.md` one level up first).

| Doc | What |
|---|---|
| [API.md](API.md) | Every route of the Kiorex API (generated) + conventions, auth, error shapes, response shapes |
| [NEEDS_HUMAN.md](NEEDS_HUMAN.md) | Open decisions that need a human (pricing, legal, clinical, credentials). **STOP flags** |
| [kiorex-cursor-build-sequence.md](kiorex-cursor-build-sequence.md) | Build steps with IDs + progress tracker |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Modules, boundaries, data ownership, money flow, booking consistency |
| [RUNBOOK.md](RUNBOOK.md) | Run locally, env vars, seeds, tests, outbox replay, reconciliation, flag operations |
| `../apps/api/openapi/kiorex-api.v1.openapi.json` | Machine-readable OpenAPI (web/ops/mobile code against this) |

Contracts: `@kiorex/contracts` (OpenAPI, event schemas, HMAC helpers, flag catalogue + evaluator) is consumed from `../kiorex-contracts/dist-pack`.
Identity is called **Kiorex Passport** everywhere (the repo and the product key keep the technical name `kiorex-account`).
