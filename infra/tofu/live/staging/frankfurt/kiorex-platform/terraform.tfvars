aws_account_id = "599243104052" # Kiorex account (aws-kiorex-profile), eu-central-1

api = {
  cpu             = "1024"
  memory          = "2048"
  min             = 1
  max             = 4
  max_concurrency = 100
  health_path     = "/api/v1/health/live"
}

db = {
  engine_version       = "16"
  instance_class       = "db.t4g.micro"
  multi_az             = false
  backup_days          = 7
  deletion_protection  = false
  skip_final_snapshot  = true
  storage_gb           = 20
  max_storage_gb       = 50
  name                 = "kiorex_platform"
  username             = "kiorexapp"
  performance_insights = false
}

uploads = { versioning = true, kms = true }

env_vars = {
  NODE_ENV        = "production"
  PSP_MODE        = "sandbox-fake" # INTEGRATION.md: no real PSP keys outside prod
  MESSAGING_MODE  = "log"
  AI_PROVIDER     = "fake"
  SWAGGER_ENABLED = "false"
}

domain             = ""
waf_enabled        = false
use_cmk            = true
log_retention_days = 30
alarm_emails       = [] # NEEDS_HUMAN

# Optional attachments - disabled by default (KX-21 §08). Flip when the milestone needs them.
enable_opensearch = false # from M9
enable_redis      = false # when the slot cache needs it

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

enable_demo_seed = true # Q10: staging demo data (non-production only; seeded by hand via scripts/seed-staging.sh)
