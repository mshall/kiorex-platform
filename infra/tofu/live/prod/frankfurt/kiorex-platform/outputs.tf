output "app_url" {
  description = "HTTPS URL of the product (SPA + /api/*)."
  value       = module.kiorex_platform.app_url
}

output "api_origin" {
  description = "Direct App Runner URL."
  value       = module.kiorex_platform.api_origin
}

output "db_secret_arn" {
  description = "RDS-managed master secret ARN."
  value       = module.kiorex_platform.db_secret_arn
}

output "db_endpoint" {
  description = "Database host:port."
  value       = module.kiorex_platform.db_endpoint
}

output "db_seed_function_name" {
  description = "Seed Lambda name (non-prod)."
  value       = module.kiorex_platform.db_seed_function_name
}

output "host_cell" {
  description = "Data residency cell."
  value       = module.kiorex_platform.host_cell
}

output "data_region" {
  description = "Data region."
  value       = module.kiorex_platform.data_region
}

output "ecr_repository_url" {
  description = "API image repository."
  value       = module.kiorex_platform.ecr_repository_url
}

output "seed_ecr_repository_url" {
  description = "Seed image repository (non-prod)."
  value       = module.kiorex_platform.seed_ecr_repository_url
}

output "web_bucket" {
  description = "Web bucket for aws s3 sync."
  value       = module.kiorex_platform.web_bucket
}

output "uploads_bucket" {
  description = "Uploads bucket."
  value       = module.kiorex_platform.uploads_bucket
}

output "distribution_id" {
  description = "CloudFront distribution id."
  value       = module.kiorex_platform.distribution_id
}

output "alerts_topic_arn" {
  description = "SNS alert topic."
  value       = module.kiorex_platform.alerts_topic_arn
}

output "app_runner_service_name" {
  description = "App Runner service name."
  value       = module.kiorex_platform.app_runner_service_name
}

output "app_runner_service_arn" {
  description = "App Runner service ARN."
  value       = module.kiorex_platform.app_runner_service_arn
}

output "safety_alerts_topic_arn" {
  description = "Safety on-call SNS topic (null when disabled)."
  value       = module.kiorex_platform.safety_alerts_topic_arn
}

output "demo_seed_function_name" {
  description = "Demo seed Lambda (staging only; null unless enable_demo_seed)."
  value       = module.kiorex_platform.demo_seed_function_name
}

output "demo_seed_invoke" {
  description = "How to run the demo seed after the staging deploy (a human runs it; see scripts/seed-staging.sh)."
  value       = module.kiorex_platform.demo_seed_invoke
}
