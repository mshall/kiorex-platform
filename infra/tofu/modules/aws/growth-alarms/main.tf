# G-27 growth alarms. Metric filters on the API's application log group and one alarm per signal. The module reads log lines only (no PHI is ever logged in the growth
# folders: ids, codes and counts). Until a signal is logged the alarm stays OK (treat_missing_data = notBreaching). Applying is a human step (ADR-028, no deploy until the founder says so).
#
# LOG CONTRACT (plain text terms, quoted so CloudWatch matches them as terms):
#   "LOYALTY_NEGATIVE_BALANCE" | "LOYALTY_CONVERT_LOT_MISMATCH" | "append-only"  a growth ledger invariant tripped in the database (loyalty, rewards, credit, corporate)
#   "PROMOTION_RESERVE_BUSY"                                                      the Clinic sponsored-promotion reserve queue was full (503 with Retry-After)
#   "revenue fact not recorded" | "revenue confirmation for"                      a commission charge fact could not be stored (revenue figures would be short)
#   "CDN purge NOT_CONFIGURED" | "CDN purge FAILED"                              a page purge did not reach the CDN (stale public pages)
#   "growth fraud shadow"                                                         (reserved) fraud scoring in shadow produced a HIGH band; informational

locals {
  namespace = "Kiorex/Growth/${var.name}"
  filters = {
    LedgerInvariant      = { pattern = "?\"LOYALTY_NEGATIVE_BALANCE\" ?\"LOYALTY_CONVERT_LOT_MISMATCH\" ?\"is append-only\"", threshold = 0, period = 60, desc = "A growth ledger invariant tripped in the database (a write that would break a balance or edit history was refused). Money or points paths: look at the audit log and the failing request id." }
    PromotionReserveBusy = { pattern = "\"PROMOTION_RESERVE_BUSY\"", threshold = var.promotion_busy_threshold, period = 300, desc = "The sponsored-promotion reserve queue answered busy more than the threshold in 5 minutes: a promotion is being hammered or the database is slow. Bookings fall back to no discount; nothing is lost." }
    RevenueFactFailed    = { pattern = "?\"revenue fact not recorded\" ?\"revenue confirmation for\"", threshold = 4, period = 300, desc = "Commission charge facts could not be stored: Kiorex revenue figures would be short until the webhook is replayed." }
    CdnPurgeFailed       = { pattern = "?\"CDN purge NOT_CONFIGURED\" ?\"CDN purge FAILED\"", threshold = 0, period = 300, desc = "A page purge did not reach the CDN: public pages can stay stale up to their TTL. Expected while the real adapter is not configured (go-live item), then a page." }
  }
  actions = compact([var.alerts_topic_arn])
}

resource "aws_cloudwatch_log_metric_filter" "this" {
  for_each       = local.filters
  name           = "${var.name}-growth-${lower(each.key)}"
  log_group_name = var.application_log_group_name
  pattern        = each.value.pattern

  metric_transformation {
    name      = "Growth${each.key}"
    namespace = local.namespace
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "this" {
  for_each            = local.filters
  alarm_name          = "${var.name}-growth-${lower(each.key)}"
  alarm_description   = each.value.desc
  namespace           = local.namespace
  metric_name         = "Growth${each.key}"
  statistic           = "Sum"
  period              = each.value.period
  evaluation_periods  = 1
  threshold           = each.value.threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
  tags                = var.tags
  depends_on          = [aws_cloudwatch_log_metric_filter.this]
}
