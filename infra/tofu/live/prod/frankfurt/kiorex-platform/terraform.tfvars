aws_account_id = "REPLACE_WITH_PROD_ACCOUNT_ID" # NEEDS_HUMAN: production account (HB05). Intentionally invalid so plan/apply fails until decided.

api = {
  cpu             = "1024"
  memory          = "2048"
  min             = 2 # KX-21 §08: App Runner 2-25
  max             = 25
  max_concurrency = 100
  health_path     = "/api/v1/health/live"
}

db = {
  engine_version       = "16"
  instance_class       = "db.t4g.medium"
  multi_az             = true
  backup_days          = 35
  deletion_protection  = true
  skip_final_snapshot  = false
  storage_gb           = 20
  max_storage_gb       = 100
  name                 = "kiorex_platform"
  username             = "kiorexapp"
  performance_insights = true
}

uploads = { versioning = true, kms = true }

env_vars = {
  NODE_ENV        = "production"
  SWAGGER_ENABLED = "false"
  # NEEDS_HUMAN: production PSP / messaging / AI modes are founder decisions (PSP onboarding, Meta templates, KX-11).
  PSP_MODE       = "TODO_NEEDS_HUMAN"
  MESSAGING_MODE = "TODO_NEEDS_HUMAN"
  AI_PROVIDER    = "TODO_NEEDS_HUMAN"
}

domain             = "kiorex.com" # HB08 - requires live/prod/global/dns applied first
zone_name          = "kiorex.com"
waf_enabled        = true
use_cmk            = true
log_retention_days = 90
alarm_emails       = [] # NEEDS_HUMAN
alarm_webhook_urls = [] # NEEDS_HUMAN
budget_usd         = 0  # NEEDS_HUMAN

enable_opensearch = false # from M9 (KX-21 §08)
enable_redis      = false

scheduled_jobs = {
  # PLACEHOLDER job names/paths - align with the API's internal job endpoints. Infra only owns the clock.
  outbox-sweep  = { schedule = "rate(1 minute)", path = "/api/v1/internal/jobs/outbox-sweep" }
  hold-expiry   = { schedule = "rate(1 minute)", path = "/api/v1/internal/jobs/hold-expiry" }
  flag-snapshot = { schedule = "rate(5 minutes)", path = "/api/v1/internal/jobs/flag-snapshot-refresh" }
  # Money paths stay DISABLED until the founder marks the Kiorex Pay gate satisfied (ADR-024).
  settlement-run = { schedule = "cron(0 3 * * ? *)", path = "/api/v1/internal/jobs/settlement-run", timezone = "Africa/Cairo", enabled = false }
  reconciliation = { schedule = "cron(30 4 * * ? *)", path = "/api/v1/internal/jobs/reconciliation", timezone = "Africa/Cairo", enabled = false }
}

# Containers only - values are entered by a human in Secrets Manager (never via OpenTofu).
placeholder_secrets = [
  "psp-paymob",
  "psp-fawry",
  "psp-instapay",
  "whatsapp-cloud-api",
  "marketplace-hmac-clients",
  "flag-control-product-keys",
  "openai-eu",
]

# --- Rev 2.3 / KX-23: Kiorex consumes SAFETY_ALERT_RAISED (KX-09) -> Kiorex ops safety console (backlog item 7; nothing applied) ---
# Alarms only: end-to-end latency (event occurredAt -> ops notified) must stay <= 60 s, and any consume failure (outbox DEAD) pages.
# They read the platform API's structured logs (see modules/aws/safety-alerts/main.tf for the log contract) and stay OK until the
# platform emits those events (KXMOP12). Safety on-call rota is NEEDS_HUMAN.
safety_alerts = {
  enabled              = true
  role                 = "consumer"
  latency_threshold_ms = 60000
  alarm_emails         = [] # NEEDS_HUMAN: safety on-call rota
  alarm_webhook_urls   = []
}

enable_demo_seed = false # Q10: never seed demo data in prod (the plan fails if this is true)

# ADR-040 front door: EMPTY container /kiorex-platform/prod/partner-lead-signing. Founder steps (docs: kiorex-platform Docs/NEEDS_HUMAN.md "Partner lead signing secret"):
#   1. tofu apply (creates the container)  2. kiorex-platform/scripts/setup-partner-lead-secret.sh prod  3. set lead_signing_secret_inject = true and apply.
lead_signing_secret        = true
lead_signing_secret_inject = false

# GRW-P1-C growth link token secret: 1. tofu apply with growth_link_token_secret = true (EMPTY container)  2. a human writes the value (>= 16 chars)  3. set growth_link_token_secret_inject = true and apply. NEEDS_HUMAN (CTO, secrets).
growth_link_token_secret        = false
growth_link_token_secret_inject = false
