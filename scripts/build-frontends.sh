#!/usr/bin/env bash
# Release build of the three browser apps of this repo: patient web, ops console, booking widget. Host-agnostic: the output is plain static files for any static host or CDN.
#   VITE_OIDC_AUTHORITY=https://<passport issuer> scripts/build-frontends.sh [web|ops|widget ...] [--out <dir>]      (default: all three, into dist-release/)
# Why a script: the SPAs have NO production fallback for the sign-in server (a localhost default exists in development only). Without VITE_OIDC_AUTHORITY the build succeeds but the bundle throws
# "VITE_OIDC_AUTHORITY is not set" the moment someone signs in. This script refuses to build web or ops without it, and refuses a local or non-https value.
# Build-time variables (names only; every one is public by design, they end up in the JS):
#   VITE_OIDC_AUTHORITY   REQUIRED for web and ops. The EXACT issuer string of Passport (https, no trailing slash unless the issuer has one; must equal OIDC_ISSUER of the API).
#   VITE_OIDC_CLIENT_ID   optional. Defaults: web kiorex-web, ops kiorex-ops (the Passport client ids). The redirect URI is <origin>/auth/callback: register it on that client.
#   VITE_MAP_PROVIDER     optional, web only: mock (default) | osm | style | amazon (+ VITE_MAP_TILES_URL / VITE_MAP_STYLE_URL / VITE_AMAZON_LOCATION_STYLE_URL, see apps/web/.env.example).
#   The widget has no build-time variable (it calls /api/v1 on the origin that serves it; its base path /v1/embed/assets/ is fixed).
#   ALLOW_LOCAL_AUTHORITY=true  lets a local build (a localhost or http issuer) through, for a smoke test only; never for a release.
# Output: <out>/web, <out>/ops, <out>/widget/app, <out>/widget/sdk. After building, run scripts/check-release-bundle.sh on <out>/web and <out>/ops. Serve web and ops with SPA fallback to index.html and /api/* proxied to the API.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="dist-release"; TARGETS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --out) OUT="${2:?--out needs a directory}"; shift 2 ;;
    web|ops|widget) TARGETS+=("$1"); shift ;;
    -h|--help) sed -n 2,16p "$0"; exit 0 ;;
    *) echo "unknown argument: $1 (usage: $0 [web|ops|widget ...] [--out dir])" >&2; exit 2 ;;
  esac
done
[ "${#TARGETS[@]}" -gt 0 ] || TARGETS=(web ops widget)

needs_authority=false
for t in "${TARGETS[@]}"; do [ "$t" = widget ] || needs_authority=true; done
if $needs_authority; then
  A="${VITE_OIDC_AUTHORITY:-}"
  if [ -z "$A" ]; then echo "VITE_OIDC_AUTHORITY is required to build web or ops (the exact https issuer of Passport). Without it the bundle cannot sign anyone in." >&2; exit 2; fi
  if [ "${ALLOW_LOCAL_AUTHORITY:-}" != "true" ]; then
    case "$A" in https://*) ;; *) echo "VITE_OIDC_AUTHORITY must be an https URL for a release build (got a non-https value). ALLOW_LOCAL_AUTHORITY=true overrides for a smoke test." >&2; exit 2 ;; esac
    case "$A" in *localhost*|*127.0.0.1*|*0.0.0.0*) echo "VITE_OIDC_AUTHORITY points at a local address: refusing a release build." >&2; exit 2 ;; esac
  fi
fi

mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
export NODE_ENV=production
for t in "${TARGETS[@]}"; do
  echo "== building $t -> $OUT"
  case "$t" in
    web) rm -rf "$OUT/web"; VITE_OIDC_CLIENT_ID="${VITE_OIDC_CLIENT_ID:-kiorex-web}" npm run build -w apps/web -- --outDir "$OUT/web" --emptyOutDir ;;
    ops) rm -rf "$OUT/ops"; VITE_OIDC_CLIENT_ID="${VITE_OIDC_CLIENT_ID:-kiorex-ops}" npm run build -w apps/ops -- --outDir "$OUT/ops" --emptyOutDir ;;
    widget) npm run build -w apps/widget; rm -rf "$OUT/widget"; mkdir -p "$OUT/widget"; cp -R apps/widget/dist/app apps/widget/dist/sdk "$OUT/widget/" ;;
  esac
done

# the bundle must name the issuer it was built for (a build that silently lost the variable would fail here, not at the first sign-in)
if $needs_authority; then
  for t in "${TARGETS[@]}"; do
    [ "$t" = widget ] && continue
    if ! grep -rqF -- "$VITE_OIDC_AUTHORITY" "$OUT/$t"; then echo "FAIL: the $t bundle does not contain the issuer $VITE_OIDC_AUTHORITY" >&2; exit 1; fi
    echo "ok   $t: bundle carries the issuer"
  done
fi
echo "done: $OUT"
