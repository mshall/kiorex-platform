# kiorex-platform

Kiorex marketplace platform: patient web, ops console / super admin, Expo mobile app and the **Kiorex API** (NestJS modular monolith with the
feature-flag control plane, Kiorex Pay, AI gateway). Part of the Kiorex v2 ecosystem — see `../CLAUDE.md` and `../INTEGRATION.md`.

```
apps/api      NestJS 10 + Prisma 6, :4000, /api/v1   (this README's quickstart)
apps/web      patient web (Vite, :5180)
apps/ops      ops console / super admin (:5181)
apps/mobile   Expo app
packages/*    shared libs
Docs/         hub: API.md, ARCHITECTURE.md, RUNBOOK.md, NEEDS_HUMAN.md, build sequence
```

Quickstart: see [Docs/RUNBOOK.md](Docs/RUNBOOK.md). `npm install && npm run db:deploy -w apps/api && npm run db:seed -w apps/api && npm run dev`.
Checks: `npm run lint && npm run typecheck && npm test`. API reference: [Docs/API.md](Docs/API.md).
