#!/usr/bin/env bash
# Refresh the vendored @kiorex/contracts tarball (no GitHub Packages needed).
# Usage: scripts/vendor-contracts.sh [path-to-kiorex-contracts]   (default: ../kiorex-contracts, the sibling checkout)
# Builds + packs the contracts repo, copies the tarball to vendor/, repoints apps/api/package.json and refreshes the lockfile.
# Commit vendor/*.tgz, apps/api/package.json and package-lock.json together. Old tarballs are removed.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:-../kiorex-contracts}"
[ -f "$SRC/package.json" ] || { echo "kiorex-contracts not found at $SRC" >&2; exit 1; }
VERSION="$(node -p "require('$SRC/package.json').version")"
(cd "$SRC" && npm run pack:local >/dev/null)
TGZ="kiorex-contracts-$VERSION.tgz"
[ -f "$SRC/dist-pack/$TGZ" ] || { echo "missing $SRC/dist-pack/$TGZ" >&2; exit 1; }
mkdir -p vendor
find vendor -name 'kiorex-contracts-*.tgz' ! -name "$TGZ" -delete
cp "$SRC/dist-pack/$TGZ" "vendor/$TGZ"
node -e "
const fs=require('fs');const p='apps/api/package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));
j.dependencies['@kiorex/contracts']='file:../../vendor/$TGZ';fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');"
npm install --package-lock-only --ignore-scripts >/dev/null
echo "vendored @kiorex/contracts $VERSION -> vendor/$TGZ"
