#!/usr/bin/env bash
# ADR-040 front door: generate ONE random 256-bit partner-lead signing secret and store the SAME value in
#   Kiorex Platform  /kiorex-platform/<env>/partner-lead-signing   -> env PARTNER_LEAD_SIGNING_SECRET   (verifier)
#   Kiorly Pharmacy  /kiorly-pharmacy/<env>/kiorex-lead-signing    -> env KIOREX_LEAD_SIGNING_SECRET    (signer)
#   Kiorly Lab       /kiorly-lab/<env>/kiorex-lead-signing         -> env KIOREX_LEAD_SIGNING_SECRET    (signer)
#   Kiorly Clinic    /kiorly-clinic/<env>/kiorex-lead-signing      -> env KIOREX_LEAD_SIGNING_SECRET    (signer)
# The EMPTY containers are created by OpenTofu (lead_signing_secret = true in each product's live stack). Run `tofu apply` first.
#
#   scripts/setup-partner-lead-secret.sh <env> [--rotate | --finish-rotation] [--profile <aws-profile>] [--region <r>]
#                                        [--targets platform,pharmacy,lab,clinic]
#                                        [--profile-platform P] [--profile-pharmacy P] [--profile-lab P] [--profile-clinic P]
#
# - Default (idempotent): fills only the containers that have no value yet; never overwrites. If Kiorex already holds a secret, the products get
#   that same value. A product that holds a different value is reported as MISMATCH (exit 6) and left untouched.
# - --rotate: new secret. Kiorex is set to "<new>,<old>" (dual accept), then every product gets <new>. Redeploy all services, then run
#   --finish-rotation to drop the old secret from Kiorex. Only two values are ever accepted by Kiorex.
# - --finish-rotation: refuses unless every product already holds the new secret, then sets Kiorex to "<new>" only.
# - Secrets travel by shell variable + stdin pipes only: no temp files, no argv, no `set -x`, the value is NEVER printed.
#   Output = status lines and secret ARNs. App Runner resolves secrets when an instance starts: redeploy a service after its value changes.
# - AWS profile: --profile, else AWS_PROFILE, else aws-kiorex-profile (staging account, eu-central-1). prod requires an explicit --profile.
set -euo pipefail
set +x

usage() { echo "usage: $0 <env> [--rotate | --finish-rotation] [--profile <aws-profile>] [--region <region>] [--targets platform,pharmacy,lab,clinic] [--profile-<target> <aws-profile>]" >&2; exit 2; }
ENV_NAME="${1:-}"
[ -n "$ENV_NAME" ] || usage
shift
case "$ENV_NAME" in *[!a-z0-9-]*|"") echo "env must match [a-z0-9-]+" >&2; exit 2;; esac

MODE=default
REGION="${AWS_REGION:-eu-central-1}"
PROFILE=""
PROFILE_SET=0
TARGETS="platform,pharmacy,lab,clinic"
P_PLATFORM=""; P_PHARMACY=""; P_LAB=""; P_CLINIC=""
while [ $# -gt 0 ]; do
  case "$1" in
    --rotate) MODE=rotate;;
    --finish-rotation) MODE=finish;;
    --profile) shift; PROFILE="${1:?--profile needs a value}"; PROFILE_SET=1;;
    --region) shift; REGION="${1:?--region needs a value}";;
    --targets) shift; TARGETS="${1:?--targets needs a value}";;
    --profile-platform) shift; P_PLATFORM="${1:?needs a value}";;
    --profile-pharmacy) shift; P_PHARMACY="${1:?needs a value}";;
    --profile-lab) shift; P_LAB="${1:?needs a value}";;
    --profile-clinic) shift; P_CLINIC="${1:?needs a value}";;
    *) echo "unknown argument: $1" >&2; usage;;
  esac
  shift
done

if [ "$PROFILE_SET" -eq 0 ]; then
  if [ "$ENV_NAME" = "prod" ] && [ -z "${AWS_PROFILE:-}" ]; then
    echo "prod needs an explicit --profile (the production account is chosen by the founder). Nothing was changed." >&2; exit 2
  fi
  PROFILE="${AWS_PROFILE:-aws-kiorex-profile}"
fi
for bin in aws openssl; do command -v "$bin" >/dev/null || { echo "missing dependency: $bin" >&2; exit 4; }; done

# platform is always part of the run: it is the verifier and the source of truth for "current".
case ",$TARGETS," in *,platform,*) ;; *) TARGETS="platform,${TARGETS}";; esac
for t in $(printf '%s' "$TARGETS" | tr ',' ' '); do
  case "$t" in platform|pharmacy|lab|clinic) ;; *) echo "unknown target: $t" >&2; exit 2;; esac
done
PRODUCTS=""
for t in $(printf '%s' "$TARGETS" | tr ',' ' '); do [ "$t" = "platform" ] || PRODUCTS="$PRODUCTS $t"; done

secret_id() {
  case "$1" in
    platform) printf '/kiorex-platform/%s/partner-lead-signing' "$ENV_NAME";;
    pharmacy) printf '/kiorly-pharmacy/%s/kiorex-lead-signing' "$ENV_NAME";;
    lab)      printf '/kiorly-lab/%s/kiorex-lead-signing' "$ENV_NAME";;
    clinic)   printf '/kiorly-clinic/%s/kiorex-lead-signing' "$ENV_NAME";;
  esac
}
profile_of() {
  local p=""
  case "$1" in platform) p="$P_PLATFORM";; pharmacy) p="$P_PHARMACY";; lab) p="$P_LAB";; clinic) p="$P_CLINIC";; esac
  printf '%s' "${p:-$PROFILE}"
}
# sm <target> <secretsmanager args...>
sm() { local t="$1"; shift; aws --profile "$(profile_of "$t")" --region "$REGION" secretsmanager "$@"; }

arn_of() { sm "$1" describe-secret --secret-id "$(secret_id "$1")" --query ARN --output text 2>/dev/null; }
# has_value <target>: 0 = holds a value. Uses metadata only (version stages); the value is not read.
has_value() {
  local v; v="$(sm "$1" describe-secret --secret-id "$(secret_id "$1")" --query VersionIdsToStages --output json 2>/dev/null)" || return 2
  [ "$v" != "null" ] && [ "$v" != "{}" ] && [ -n "$v" ]
}
read_value() { sm "$1" get-secret-value --secret-id "$(secret_id "$1")" --query SecretString --output text; }
write_value() { printf '%s' "$2" | sm "$1" put-secret-value --secret-id "$(secret_id "$1")" --secret-string file:///dev/stdin --query ARN --output text >/dev/null; }
first_of() { printf '%s' "${1%%,*}"; }
second_of() { case "$1" in *,*) printf '%s' "${1#*,}";; *) printf '';; esac; }
report() { echo "OK: $1 ($(secret_id "$1")) $2"; echo "ARN: $(arn_of "$1")"; }

# Pre-flight: every selected container must exist (created by `tofu apply`).
MISSING=""
for t in $(printf '%s' "$TARGETS" | tr ',' ' '); do
  arn_of "$t" >/dev/null 2>&1 || MISSING="$MISSING $(secret_id "$t")"
done
if [ -n "$MISSING" ]; then
  echo "Missing Secrets Manager containers (run tofu apply with lead_signing_secret = true first, or check --profile/--region):" >&2
  for m in $MISSING; do echo "  $m" >&2; done
  echo "Nothing was changed." >&2; exit 5
fi

PLATFORM_VALUE=""
if has_value platform; then PLATFORM_VALUE="$(read_value platform)"; fi
CUR="$(first_of "$PLATFORM_VALUE")"
PREV="$(second_of "$PLATFORM_VALUE")"

case "$MODE" in
  default)
    if [ -z "$CUR" ]; then CUR="$(openssl rand -hex 32)"; write_value platform "$CUR"; report platform "created"; else report platform "unchanged"; fi
    RC=0
    for t in $PRODUCTS; do
      if has_value "$t"; then
        V="$(read_value "$t")"
        if [ "$V" = "$CUR" ]; then report "$t" "unchanged"
        elif [ -n "$PREV" ] && [ "$V" = "$PREV" ]; then report "$t" "still on the PREVIOUS secret (rotation in progress: redeploy it, then --finish-rotation)"
        else echo "MISMATCH: $t ($(secret_id "$t")) holds a different value than Kiorex; left untouched. Use --rotate to realign every service." >&2; RC=6
        fi
        V=""
      else
        write_value "$t" "$CUR"; report "$t" "created"
      fi
    done
    CUR=""; PREV=""; PLATFORM_VALUE=""
    [ "$RC" -eq 0 ] || exit "$RC"
    echo "Next: set lead_signing_secret_inject = true in each live stack and apply (OpenTofu wires the secret into the runtime env); then redeploy Kiorex and the products."
    ;;
  rotate)
    if [ -z "$CUR" ]; then echo "Nothing to rotate: Kiorex holds no secret yet. Run without --rotate first." >&2; exit 7; fi
    if [ -n "$PREV" ]; then echo "A rotation is already in progress (Kiorex accepts a previous secret). Redeploy the services, then run --finish-rotation first." >&2; exit 7; fi
    NEW="$(openssl rand -hex 32)"
    write_value platform "${NEW},${CUR}"; report platform "rotated: accepts the new AND the previous secret"
    for t in $PRODUCTS; do write_value "$t" "$NEW"; report "$t" "rotated"; done
    NEW=""; CUR=""; PLATFORM_VALUE=""
    echo "Next: REDEPLOY Kiorex and every product now (App Runner reads secrets at instance start), verify a Talk to us lead, then run: $0 $ENV_NAME --finish-rotation"
    ;;
  finish)
    if [ -z "$PREV" ]; then echo "No rotation in progress (Kiorex accepts only one secret). Nothing was changed."; exit 0; fi
    for t in $PRODUCTS; do
      has_value "$t" || { echo "$t has no value; run without flags first. Nothing was changed." >&2; exit 7; }
      V="$(read_value "$t")"
      [ "$V" = "$CUR" ] || { echo "$t does not hold the new secret yet; refusing to drop the previous one. Nothing was changed." >&2; exit 7; }
      V=""
    done
    write_value platform "$CUR"; report platform "rotation finished: previous secret dropped"
    CUR=""; PREV=""; PLATFORM_VALUE=""
    echo "Next: redeploy Kiorex so it stops reading the previous secret (health/ready shows previousAccepted=false)."
    ;;
esac
