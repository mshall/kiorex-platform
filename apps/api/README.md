# @kiorex/api (Kiorex API)

NestJS 12 modular monolith with Prisma 7 on PostgreSQL 16. Port `4000`, prefix `/api/v1`. Back to the [platform README](../../README.md).

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
| `prisma/` | `schema.prisma`, migrations, `seed.ts`, `demo/` fixtures; `prisma.config.ts` (next to `package.json`) holds the datasource URL and seed command (Prisma 7) |
| `src/prisma/` | `PrismaService`, `client-factory.ts` (pg driver adapter; maps `schema`/`sslmode`/`connection_limit` URL params) and the generated client in `generated/` (git-ignored; created by `prisma generate`, run automatically by `build`, `lint`, `typecheck` and `test:unit`) |
| `openapi/` | Generated `kiorex-api.v1.openapi.json` (web, ops and mobile code against it) |
| `test/` | Integration specs with an in-process fake Kiorly and a local JWKS |
| `scripts/` | Seed and sync helpers |

Env template: `.env.example`. Reference: [Docs/RUNBOOK.md](../../Docs/RUNBOOK.md), [Docs/API.md](../../Docs/API.md).
