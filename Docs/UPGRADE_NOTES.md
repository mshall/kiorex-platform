# Dependency and toolchain upgrade (20 Nov 2026)

Founder request: everything to the latest stable. This page records what moved, what had to change in the code, and what is
deliberately pinned. Done on `main` in one commit per group (toolchain, TypeScript/test tooling, NestJS, Prisma, frontend, Tailwind, mobile, audit).
Nothing was pushed, deployed or applied: infra changes are edits plus `tofu validate` only.

## Versions (before to after)

| Area | Before | After |
|---|---|---|
| Node.js | 22 (CI, Lambda image), `>=20` engines, no `.nvmrc` | **26 LTS** (`.nvmrc`, `engines >=26`, CI `setup-node` 26, `lambda/nodejs:26`, Lambda runtime `nodejs26.x`) |
| npm | 11 | **12** (`engines >=12`) |
| TypeScript | 5.9 | **6.0.3** (7.0 blocked, see below) |
| NestJS (`common/core/platform-express/testing`) | 10.4 | **12.5** (Express 5 types, ESM packages) |
| `@nestjs/swagger`, `@nestjs/cli` | 7.4, 10.4 | **12.1, 12.0** |
| Prisma (client, CLI) | 6.19 | **7.10.1** + `@prisma/adapter-pg`, `pg`, `dotenv` 18 |
| class-validator, jose, fast-check, supertest types | 0.14, 5, 3, 6 | **0.15, 6, 4, 7** |
| Jest | 29 | **30** (ts-jest 29.4) |
| Vite, Vitest, plugin-react-swc | 5, 2, 3 | **8, 5, 4** |
| ESLint, `@eslint/js`, react-hooks plugin | 9, 9, 5 | **10, 10, 7** |
| React, React DOM, `@types/react` | 18.3 | **19.3** |
| React Router | 6.30 | **7.18** (`react-router-dom` shim kept) |
| Tailwind CSS | 3.4 | **4.3** (`@tailwindcss/postcss`, brand preset loaded via `@config`) |
| TanStack Query, i18next, react-i18next | 5.108, 25, 15 | **5.108.1, 27, 18** |
| zod, date-fns, lucide-react, sonner, maplibre-gl, MSW, openapi-fetch | 3, 3, 0.462, 1.7, 5.9, 2, 0.13 | **4, 4, 1.x, 2, 6, 3, 0.17** |
| Playwright | 1.65.1 | 1.65.1 (already latest) |
| Expo SDK / React Native / React (mobile) | 58 / 0.88 / 19.3 | **SDK 58.0.26 / 0.88.1 / 19.3.0** (already the latest SDK; `expo install --fix` aligned the exact pins) |
| GitHub Actions | checkout v4/v6, setup-node v4, gitleaks v2, setup-opentofu v1, setup-tflint v4, trivy 0.28, github-script v7 | **checkout v7, setup-node v7, gitleaks v3, setup-opentofu v2, setup-tflint v6, trivy v0.36, github-script v9** (configure-aws-credentials v6 already latest) |
| OpenTofu / providers | 1.13.9; aws 6.73, random 3.9, archive 2.8 | unchanged (already latest; `tofu validate` passes for staging and prod) |

## What changed in the code

- **TypeScript 6**: `baseUrl` removed (all `paths` are relative already); `rootDir` set explicitly in the API tsconfigs (6.0 no longer infers it);
  `isolatedModules` moved from the ts-jest option into `tsconfig.json`. Web and ops import `defineConfig` from `vitest/config`.
- **NestJS 12**: core packages are ESM-only and CommonJS apps load them with `require(esm)` (Node 26 is fine). Jest needs
  `NODE_OPTIONS=--experimental-vm-modules`; the `test:*` scripts and the CI contract step set it. `@ApiProperty({ required: false })` on an object
  schema no longer type-checks in swagger 12, so the one use became `@ApiPropertyOptional`. Regenerated OpenAPI differs only in key order and one description.
- **Prisma 7** (the big one): driver adapter instead of the Rust engine; `prisma-client` generator with `moduleFormat = "cjs"` writing to
  `apps/api/src/prisma/generated/` (git-ignored, treated as part of the shared `prisma/` kernel by the module-boundary rule); datasource URL moved
  from `schema.prisma` to `apps/api/prisma.config.ts`; `.env` is loaded with `dotenv`. `src/prisma/client-factory.ts` builds the `PrismaPg` adapter and
  translates the Prisma-style URL params we already use (`schema`, `sslmode=no-verify|require`, `connection_limit`, `connect_timeout`; default connect timeout
  stays 5 s as in Prisma 6). Seeds use the same factory. `db:migrate` now also runs `prisma generate` (Prisma 7 no longer does). The seed Dockerfile installs
  `prisma@7.10.1` and copies `prisma.config.ts`. Verified against scratch databases: all migrations apply from zero, base seed runs from ts-node and from the compiled
  `dist-seed`, compiled `dist` connects through the adapter. `lint`/`pretest:unit` run `prisma generate` so a clean checkout works.
  `prisma migrate diff` shows one pre-existing difference (the hand-written `Provider.searchText` trigram index is not modelled in the schema); unchanged by this upgrade.
- **React 19 / Tailwind 4 / frontend**: `JSX` namespace and the `GeoJSON` global replaced by explicit imports (`React.JSX`, `@types/geojson`); MSW 3 option renamed
  to `onUnhandledFrame`; mobile `initImmediate` became `initAsync` (i18next 24+). Tailwind was migrated with `@tailwindcss/upgrade`; the tool also renamed Button
  variants named `outline` to `outline-solid` in three call sites, which were reverted by hand.
- **Mobile**: `expo install --fix` pins; removed the unneeded direct `expo-modules-core` dependency and the obsolete `newArchEnabled` flag (always on in SDK 58);
  `expo export` for web and iOS bundles, `expo-doctor` only reports the intentional Metro isolation (`disableHierarchicalLookup`, needed because the root workspace hoists its own React).
- **Test isolation**: `TEST_DATABASE_URL` overrides the hard-coded integration database (defaults unchanged).

## Pinned or blocked

| Item | Pinned at | Why | What unblocks it |
|---|---|---|---|
| TypeScript 7.0 (native compiler) | 6.0.3 | `typescript-eslint` supports `<6.1`, `@nestjs/swagger` 12 and Expo's pin are `^5/^6`, `ts-jest` `<7`; the 7.0 JS API used by these tools is not available | typescript-eslint, swagger and Expo declaring TS 7 support |
| Prisma 8 | 7.10.1 | npm `latest` for the CLI is `8.0.0-rc.34`, a release candidate; `@prisma/client` latest is still 7.10.1 | stable Prisma 8 |
| `@babel/core` (mobile) | 7.29.x | `babel-preset-expo` / `expo-doctor` require `^7.29.7`; Babel 8 bundles but is flagged | Expo SDK allowing Babel 8 |
| `@react-native-async-storage/async-storage` (mobile) | 2.2.0 | Expo SDK 58 bundled-native-module version; 3.x is outside it | Expo bumping its pin |
| React, react-native-reanimated, worklets, svg, gesture-handler (mobile) | Expo SDK pins (19.3.0, 4.7.1, 0.13.0, 15.16.0, 3.3.0) | `expo install --check` requires these exact versions | next Expo patch |
| PostgreSQL major | 16 (CI service image, RDS) | The database engine is an operations decision with a data-migration plan, not an npm bump; local dev cluster is 18 and the suites pass on it | a staged RDS upgrade plan |
| `eslint-plugin-react-hooks` compiler rules (`refs`, `set-state-in-effect`, `purity`, `immutability`) | off | v7 adds React Compiler diagnostics that flag ~15 valid React 19 patterns (latest-value refs, draft reset on open, countdown clocks); we do not run the compiler. `rules-of-hooks` and `exhaustive-deps` stay on | Follow-up: refactor those sites, then enable the rules |
| `openapi-typescript` 7.13 peer `typescript ^5` | works on 6.0.3 | peer range only; handled by an `overrides` entry in the root `package.json` (generated schemas are byte-compatible) | openapi-typescript release declaring TS 6 |

`overrides` in the root `package.json`: `openapi-typescript` to TypeScript 6, and `effect` `^3.22.5` (the Prisma CLI pins `effect@3.20.0`, which has a ReDoS advisory GHSA-7589-6fvf-x4pw).

## Operational notes

- npm 12 blocks dependency install scripts by default (`npm install-scripts ls`). Nothing here depends on them: engines download at `prisma generate` (none are needed with the adapter), and esbuild/swc ship prebuilt binaries.
- Ops declares no runtime dependencies of its own and relies on workspace hoisting from web (unchanged; worth cleaning up).
- Vite 8 (Rolldown) warns that `maplibre-gl` is a 1.1 MB chunk; it was already lazily isolated, so no change was made.
- Real-provider, AWS and Postgres-major work stays out of scope of this change.

## Security audit (`npm audit`)

Started at 21 findings (3 high, 18 moderate). The three high ones (Prisma CLI to `effect`) are fixed by the override above. The remaining
moderate ones are all dev-only Jest 30 transitive dependencies (`babel-plugin-istanbul`, `glob`, `minimatch` ReDoS in test globbing); npm's only offered
"fix" is downgrading to Jest 29, which re-introduces older advisories and breaks Nest 12 ESM loading, so they are accepted. Production dependency tree: no high findings.
Mobile (`apps/mobile`, own lockfile) reports moderate findings in Expo/Jest tooling only.

## Verification run (Node 26.13.1, npm 12.2.3, clean `npm ci`)

API unit 73/73, API integration 242/242 (includes contract, flag-OFF and OpenAPI contract suites, scratch DB), web 132/132, ops 32/32, mobile jest 115/115;
`typecheck` and `lint` clean in every workspace; `build` for api, web and ops; OpenAPI export produces no drift (`git diff --exit-code apps/api/openapi Docs/API.md`);
`expo export` web and iOS; `tofu fmt -check` and `tofu validate` (staging, prod); `infra/lambda/demo-seed` tests 4/4.
Playwright specs under `apps/web/e2e` need the full local stack (Passport, Kiorly, seeded data) and were not run; Playwright itself is at the latest version and a headless smoke of the landing page rendered correctly under Tailwind 4 with no console errors.
