# Kiorex API image (GRW-P1-E): ONE image, two roles. The public SEO site is a role of this image (ADR-043): SITE_ROLE=all (default, API + site),
# api (API only) or site (public pages only, same image on a second service later). Build from the repository root:
#   docker build -f apps/api/Dockerfile -t kiorex-api .
#
# NOTE (24 Nov 2026): deploy.yml has always referenced apps/api/Dockerfile but the file was not in the repository. This one is modelled on the Kiorly Clinic
# image (migrate on boot, DB secret from Secrets Manager). BUILT AND BOOTED 27 Nov 2026 against a private Postgres (see Docs/DOCKER_AND_FRONTEND_BUILDS.md); still never deployed (no deploy until the founder says so).
# Build args (browser-side, baked into the patient SPA shell this image serves; see the doc): VITE_OIDC_AUTHORITY (the exact Passport issuer, https), VITE_OIDC_CLIENT_ID, VITE_MAP_PROVIDER.
FROM node:26-bookworm-slim AS deps
WORKDIR /repo
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/ops/package.json apps/ops/
COPY apps/widget/package.json apps/widget/
COPY vendor ./vendor
RUN npm ci

FROM deps AS build
COPY apps/api ./apps/api
COPY apps/web ./apps/web
COPY apps/widget ./apps/widget
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public"
ARG VITE_OIDC_AUTHORITY=""
ARG VITE_OIDC_CLIENT_ID="kiorex-web"
ARG VITE_MAP_PROVIDER="mock"
ENV VITE_OIDC_AUTHORITY=$VITE_OIDC_AUTHORITY VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID VITE_MAP_PROVIDER=$VITE_MAP_PROVIDER
RUN [ -n "$VITE_OIDC_AUTHORITY" ] || echo "WARNING: VITE_OIDC_AUTHORITY is empty: the patient SPA in this image cannot sign anyone in (pass --build-arg VITE_OIDC_AUTHORITY=https://<passport issuer>)"
# API (prisma generate + nest build), patient SPA (dist/), public site client + SSR bundle (dist-public/)
RUN npm run build -w apps/api && npm run build:site -w apps/web && npm run build -w apps/widget

FROM node:26-bookworm-slim AS runner
WORKDIR /repo
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/ops/package.json apps/ops/
COPY apps/widget/package.json apps/widget/
COPY vendor ./vendor
# runtime dependencies of the API only; the Prisma CLI runs `migrate deploy` on boot; the Secrets Manager client is used by the entrypoint only (never by src/)
RUN npm ci --omit=dev --workspace apps/api --include-workspace-root=false \
 && npm install -g prisma@7.10.1 \
 && npm install --no-save --no-package-lock @aws-sdk/client-secrets-manager@3
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY apps/api/docker-entrypoint.mjs ./apps/api/docker-entrypoint.mjs
COPY --from=build /repo/apps/api/dist ./apps/api/dist
# the patient SPA shell (fallback and flag-OFF response) and the public site: hydration assets (/_p/*) plus the self-contained SSR bundle
COPY --from=build /repo/apps/web/dist/index.html ./apps/web/dist/index.html
COPY --from=build /repo/apps/web/dist-public ./apps/web/dist-public
# the booking widget host (GRW-P1-G, ADR-044): hashed app files, the versioned SDK and its SRI manifest; served at the root of WIDGET_HOST (default book.kiorex.com in production)
COPY --from=build /repo/apps/widget/dist/app ./apps/widget/dist/app
COPY --from=build /repo/apps/widget/dist/sdk ./apps/widget/dist/sdk

ENV NODE_ENV=production
ENV SITE_ROLE=all
# SITE_ENVIRONMENT must be set explicitly to `production` for robots.txt and sitemaps to allow indexing (staging and unset block everything).
ENV SITE_SSR_BUNDLE=/repo/apps/web/dist-public/server/entry-server.cjs \
    SITE_PUBLIC_CLIENT_DIR=/repo/apps/web/dist-public/client \
    SITE_SPA_SHELL=/repo/apps/web/dist/index.html \
    WIDGET_DIST=/repo/apps/widget/dist
WORKDIR /repo/apps/api
EXPOSE 4000
ENV PORT=4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "docker-entrypoint.mjs"]
