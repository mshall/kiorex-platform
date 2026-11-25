#!/usr/bin/env bash
# G-38 release bundle check (launch guide 9.1). Humans run it on every RELEASE build output before it ships:
#   scripts/check-release-bundle.sh <built-dir> [<built-dir> ...]
# Examples: apps/web/dist apps/ops/dist, or the folder of `npx expo export -p web`, or an unzipped Android/iOS JS bundle.
# It greps the built text files (js, mjs, css, html, json, map is ignored) for things that must never reach production:
#   dev test-user panels, synthetic demo personas and their shared password, the development OTP codes, dev IdP/local endpoints, and "DEV ONLY" banners.
# Exit 0 = clean, 1 = findings (each printed with file and pattern, never the surrounding text), 2 = usage error. No network, no writes, read-only.
# Add a pattern by appending a line to PATTERNS (label|extended regex). A finding is a release blocker until someone has looked at it.
set -u
if [ "$#" -lt 1 ]; then echo "usage: $0 <built-dir> [<built-dir> ...]" >&2; exit 2; fi

PATTERNS=(
  'dev test-user panel|data-testid="dev-test-users"|testID:"dev-test-users"|dev-test-users|DevTestUsers'
  'demo persona domain|@demo\.kiorex\.test|@nurse-demo\.kiorly\.test|@demo\.kiorly\.test'
  'demo shared password|Demo@12345'
  'development OTP|SIGNUP_OTP_DEV_CODE|AUTH_RESET_DEV_EXPOSE|\b000000\b.{0,40}otp|otp.{0,40}\b000000\b|OTP_DEV_CODE'
  'DEV ONLY marker|DEV ONLY|Test users \(dev only\)|\(dev only\)|للتطوير فقط'
  'dev IdP or local endpoint|localhost:4400|127\.0\.0\.1:4400|localhost:3010|localhost:4000|localhost:5180|10\.0\.2\.2:'
  'dev login without password|dev-login|/auth/dev-login'
)

status=0
for dir in "$@"; do
  if [ ! -d "$dir" ]; then echo "not a directory: $dir" >&2; exit 2; fi
  files=$(find "$dir" -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.css' -o -name '*.html' -o -name '*.json' -o -name '*.hbc' -o -name '*.bundle' \) ! -name '*.map' 2>/dev/null)
  if [ -z "$files" ]; then echo "WARN: no bundle files under $dir (wrong folder?)" >&2; status=1; continue; fi
  for entry in "${PATTERNS[@]}"; do
    label="${entry%%|*}"; rx="${entry#*|}"; rx="${rx//|/|}"
    # shellcheck disable=SC2086
    hits=$(grep -lE -- "$rx" $files 2>/dev/null | head -5)
    if [ -n "$hits" ]; then
      status=1; echo "FOUND [$label] in $dir:"; echo "$hits" | sed 's/^/    /'
    fi
  done
done
if [ "$status" -eq 0 ]; then echo "release bundle check: clean ($# folder(s))"; else echo "release bundle check: FINDINGS (release blocker until reviewed)" >&2; fi
exit "$status"
