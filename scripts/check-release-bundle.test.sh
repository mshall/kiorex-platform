#!/usr/bin/env bash
# Self-test of check-release-bundle.sh: a clean folder passes, each planted marker fails, usage errors exit 2.
set -u
here="$(cd "$(dirname "$0")" && pwd)"; tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
fail=0; ok() { echo "ok - $1"; }; bad() { echo "NOT ok - $1"; fail=1; }
mkdir -p "$tmp/clean" "$tmp/empty"; echo 'console.log("hello kiorex");' > "$tmp/clean/app.js"; echo '{"name":"kiorex"}' > "$tmp/clean/m.json"
"$here/check-release-bundle.sh" "$tmp/clean" >/dev/null 2>&1 && ok "clean folder passes" || bad "clean folder passes"
for marker in 'data-testid="dev-test-users"' 'owner.na@demo.kiorex.test' 'Demo@12345' 'SIGNUP_OTP_DEV_CODE' 'Test users (dev only)' 'http://localhost:4400/auth' 'fetch("/auth/dev-login")'; do
  d="$tmp/m$RANDOM"; mkdir -p "$d"; printf 'var x="%s";\n' "$marker" > "$d/index.js"
  "$here/check-release-bundle.sh" "$d" >/dev/null 2>&1; [ $? -eq 1 ] && ok "finds: $marker" || bad "finds: $marker"
done
"$here/check-release-bundle.sh" "$tmp/empty" >/dev/null 2>&1; [ $? -eq 1 ] && ok "empty folder is a warning failure" || bad "empty folder"
"$here/check-release-bundle.sh" >/dev/null 2>&1; [ $? -eq 2 ] && ok "no argument exits 2" || bad "no argument exits 2"
"$here/check-release-bundle.sh" /nonexistent-dir >/dev/null 2>&1; [ $? -eq 2 ] && ok "missing folder exits 2" || bad "missing folder exits 2"
exit $fail
