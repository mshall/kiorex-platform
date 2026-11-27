# infra/tofu — OpenTofu for Kiorex Platform

Implements ADR-028 / KX-21 §01. OpenTofu **1.13.9** (`.opentofu-version`), `hashicorp/aws ~> 6.0`. **Nothing in this
tree has been applied.** Do not deploy until the founder approves the first deploy.

```
.opentofu-version   .tflint.hcl
modules/contracts/README.md      inputs/outputs of the 10 contracts
modules/aws/{network,database,container-service,object-storage,cdn-edge,secrets,email,dns-certs,waf,observability,ci-oidc}
modules/product-stack/    one product in one cell (precondition: provider region == platform/data-cells.json)
live/{staging,prod}/frankfurt/kiorex-platform/    backend.tf main.tf variables.tf outputs.tf terraform.tfvars
```

`modules/` is a verbatim copy of the Kiorly Clinic skeleton (KX-22). Fix a module in `clinics-management` first, then re-copy.

## State
S3 (`kiorex-tofu-state-<env>-euc1`, native `use_lockfile`) + OpenTofu client-side KMS encryption (`alias/kiorex-tofu-state`)
for state **and plan** files. One state per product / environment / cell. Backend config cannot use variables, so the
bucket names are literal in each `backend.tf`.

## 1. Bootstrap (platform admin, once per account, locally with SSO/MFA)
State buckets, KMS key and GitHub roles are created by **`clinics-management/infra/tofu/bootstrap`** (one set per AWS account,
roles already trust this repo). Run it there first; nothing to bootstrap here.

## 2. Plan (local, same as CI)
```sh
export AWS_PROFILE=aws-kiorex-profile      # eu-central-1
cd infra/tofu/live/staging/frankfurt/kiorex-platform
tofu init
tofu fmt -check -recursive && tofu validate
tflint --recursive && trivy config .
tofu plan -var "git_sha=$GIT_SHA" -out plan.tfplan
```
Offline checks (no AWS): `tofu fmt -recursive && tofu init -backend=false && tofu validate` in every live directory.

## 3. Apply
Never from a laptop except documented break-glass; use `deploy.yml` (staging) and `release.yml` (production, approval).
Image first: an App Runner service needs its image, so the first apply is two-phase —
`tofu apply -target=<module>.module.container_service.aws_ecr_repository.this`, push the image tagged `$GIT_SHA`, then the full apply
(the workflows do this).
`prod` tfvars carry `aws_account_id = "REPLACE_WITH_PROD_ACCOUNT_ID"` on purpose: **NEEDS_HUMAN** decide the production
account (HB05); the validation fails until then. Staging targets the Kiorex account 599243104052.

## 4. Adopting existing resources (migration path T4-alt)
If real data already lives in the CDK stack: set CDK removal policies to RETAIN, then add `import` blocks, e.g.
```hcl
import {
  to = module.kiorex_platform.module.database[0].aws_db_instance.this
  id = "<existing-rds-identifier>"
}
```
(also VPC, S3 buckets, KMS keys), run `tofu plan` until it shows **0 changes**, `cdk destroy` the stateless rest, recreate those
with OpenTofu. Prefer greenfield (T4) while there are no live tenants.

## 5. GitHub Actions (`.github/workflows`)
`infra-plan.yml` (PR: fmt, validate, tflint, trivy, plan with read-only `tofu-plan`), `deploy.yml` (staging),
`release.yml` (production), `drift.yml` (nightly). **All apply workflows are `workflow_dispatch` only** until the founder
approves the first deploy. Repository variables: `AWS_TOFU_PLAN_ROLE_ARN`, `AWS_TOFU_APPLY_STAGING_ROLE_ARN`,
`AWS_TOFU_APPLY_PROD_ROLE_ARN` (from bootstrap outputs); GitHub Environments `staging` and `production` (required reviewers).

## Known blockers
- AWS Organization SCPs: in account 599243104052, user `cursor-admin` gets explicit denies on `cloudformation:ListStacks`,
  `apprunner:ListServices`, `rds:DescribeDBInstances`, `s3:ListAllMyBuckets`. The org admin must relax them before plan/apply.
- HB07: with App Runner VPC egress and no NAT, calls to third-party APIs need a path — verify in staging; add a NAT or egress proxy.
- tflint is not installed locally; config is kept and runs in CI. App Runner log retention is set by the AWS CLI via a
  `terraform_data` provisioner (the service owns those log groups) — runners need the AWS CLI.
- App Runner 2–25, RDS PG16 Multi-AZ, S3, EventBridge Scheduler jobs (`scheduled_jobs`: Lambda -> `POST /api/v1/internal/jobs/*` with `X-Internal-Job-Key`;
  job names/paths are placeholders; settlement/reconciliation stay `enabled = false` until the Kiorex Pay gate is satisfied).
- OpenSearch (`enable_opensearch`, from M9) and ElastiCache Redis (`enable_redis`) are disabled by default.
- Secret containers (PSP keys, WhatsApp, HMAC clients, flag product keys) are created empty — humans fill them (NEEDS_HUMAN). Prod `PSP_MODE`/`MESSAGING_MODE`/`AI_PROVIDER` are `TODO_NEEDS_HUMAN`.
- One SPA bucket/distribution: the ops console hostname/hosting (ops.kiorex.com?) is not decided (NEEDS_HUMAN).

## Rev 2.3 note: SAFETY_ALERT_RAISED alarms (KX-09, KX-23; nothing applied)
Kiorex consumes `SAFETY_ALERT_RAISED` for ops (safety console, KXMOP12), so `safety_alerts` is enabled with `role = "consumer"` in both
stacks: alarms on end-to-end latency (> 60 s) and on consume failures (outbox DEAD), published to `<product>-<env>-safety-oncall`.
They stay OK until the platform API emits `safety_alert.received` (+ `endToEndLatencyMs`) / `safety_alert.consume_failed` logs; the log
contract, alarms and rota notes are in `clinics-management/infra/tofu/README.md` section 6. The on-call rota is NEEDS_HUMAN. `modules/` was re-copied
from clinics-management (it now also contains `aws/safety-alerts`, `aws/location` and `alias_domains`; the latter two are unused here,
no resources). No alias, Location or geostamp job exists in this stack.

## 7. Demo-data seeding on staging (Q10, non-production only)
`modules/product-stack/demo_seed.tf` adds a `<name>-demo-seed` container-image Lambda (isolated subnets, DB access, least-privilege IAM, `MODE=mock`) created **only** when `enable_demo_seed = true` (default false; true only in `live/staging/**/terraform.tfvars`). A plan with `env = "prod"` and `enable_demo_seed = true` fails (`terraform_data.demo_seed_guard`), covered offline by `tofu test` in `modules/product-stack` (`tests/demo_seed_guard.tftest.hcl`, mock provider). Outputs `demo_seed_function_name` and `demo_seed_invoke` give the invocation. The Lambda image is the `<name>-seed` ECR repo built from `apps/api/Dockerfile.seed` (handler `demo-seed.handler`, source `infra/lambda/demo-seed/run.mjs`, test `node --test infra/lambda/demo-seed/run.test.mjs`). It is never invoked by OpenTofu or CI: after a human deployed staging, run `scripts/seed-staging.sh` from the workspace root (see `Docs/TEST_DATA.md` -> "Seeding staging on AWS").

## Demo seeding is an explicit opt-in (28 Nov 2026)

`modules/product-stack` variable `seed_ensure_demo_passwords` (default `false`) controls `PRISMA_SEED_ENSURE_DEMO_PASSWORDS` on the base seed Lambda (`seed.tf`) and the demo seed Lambda (`demo_seed.tf`); it used to be hard-coded `"true"`. Only the staging live stack sets it to `true` in `terraform.tfvars` (it is a demo stack together with `enable_demo_seed = true`); prod sets it `false` and the plan fails (`terraform_data.demo_password_guard`) if `env = prod` and it is `true`. The Lambdas themselves stay opt-in through `enable_seed_lambda` and `enable_demo_seed` (default `false`). Checked with `tofu init -backend=false` and `tofu validate` in the staging and prod live stacks; no plan or apply was run (these stacks are not applied anywhere; the kx-test environment is the separate `infra/tofu` root in the workspace repo and does not use this module).
