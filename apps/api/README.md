# @kiorex/api (Kiorex API)

NestJS 10 modular monolith with Prisma 6 on PostgreSQL 16. Port `4000`, prefix `/api/v1`. Back to the [platform README](../../README.md).

```bash
npm run dev -w apps/api            # watch mode
npm run db:deploy -w apps/api      # apply migrations
npm run db:seed -w apps/api        # flag registry + dev product keys
npm run test:unit -w apps/api
npm run test:integration -w apps/api
npm run test:flag-off -w apps/api
npm run openapi:export -w apps/api # writes openapi/kiorex-api.v1.openapi.json and Docs/API.md
```

| Folder | What |
|---|---|
| `src/<module>/` | 21 bounded contexts, each with a `*-public.ts` facade (see [Docs/ARCHITECTURE.md](../../Docs/ARCHITECTURE.md)) |
| `prisma/` | `schema.prisma`, migrations, `seed.ts`, `demo/` fixtures |
| `openapi/` | Generated `kiorex-api.v1.openapi.json` (web, ops and mobile code against it) |
| `test/` | Integration specs with an in-process fake Kiorly and a local JWKS |
| `scripts/` | Seed and sync helpers |

Env template: `.env.example`. Reference: [Docs/RUNBOOK.md](../../Docs/RUNBOOK.md), [Docs/API.md](../../Docs/API.md).
