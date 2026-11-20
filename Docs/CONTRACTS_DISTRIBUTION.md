# @kiorex/contracts distribution (20 Nov 2026)

**GitHub Packages publish is not possible with the current auth:** the `gh` token for account `mshall` has scopes `gist, read:org, repo` only, no `write:packages`
(and scopes were deliberately not changed interactively). `kiorex-contracts/.github/workflows/publish.yml` stays manual (`workflow_dispatch`, uses the
workflow `GITHUB_TOKEN` with `packages: write`, so it can publish from Actions once the founder approves; nothing was published).

## What CI does instead
- `@kiorex/contracts` is a `file:` dependency on the **vendored tarball** `vendor/kiorex-contracts-<version>.tgz` committed in this repo
  (`apps/api/package.json` -> `file:../../vendor/...`). `npm ci` therefore works on a plain checkout: no cross-repo checkout, no `CONTRACTS_READ_TOKEN`
  secret, no GitHub Packages token. The old workflow checked out the private `kiorex-contracts` repo with a secret that was never created and then
  needed a `dist-pack/` folder that is gitignored there, so CI could not pass.
- `apps/api/Dockerfile.seed` copies `vendor/` (no extra `--build-context`).

## Updating the contracts version
1. In `kiorex-contracts`: bump version, `npm test`, commit.
2. In this repo: `scripts/vendor-contracts.sh` (builds + packs the sibling `../kiorex-contracts`, replaces the tarball, repoints `apps/api/package.json`, refreshes
   `package-lock.json`). Commit `vendor/`, `apps/api/package.json` and `package-lock.json` together.
3. Local dev and the e2e stack (`kiorex-v2/e2e`) keep using `../kiorex-contracts/dist-pack` via `npm run pack:local`; the tarball content is identical.

## When the founder approves publishing
Run `publish` (workflow_dispatch) in `kiorex-contracts`, add `//npm.pkg.github.com/:_authToken` (read:packages PAT or `GITHUB_TOKEN` in Actions) and an `.npmrc`
with `@kiorex:registry=https://npm.pkg.github.com`, change the dependency to `"@kiorex/contracts": "1.6.0"`, delete `vendor/` and `scripts/vendor-contracts.sh`.

## Other repos (not changed here)
`kiorly-pharmacy` and `kiorly-lab` still use `file:../../../kiorex-contracts/dist-pack/...` (other agents own those repos). Apply the same recipe there
(copy `vendor-contracts.sh`, vendor the tarball, drop the cross-repo checkout step) before their CI can pass.
