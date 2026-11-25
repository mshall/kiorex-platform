output "alarm_names" {
  description = "Growth alarm names (runbook checklist)."
  value       = [for a in aws_cloudwatch_metric_alarm.this : a.alarm_name]
}

output "namespace" {
  value = local.namespace
}
