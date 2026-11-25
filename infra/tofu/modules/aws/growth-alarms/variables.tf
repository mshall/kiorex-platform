variable "name" {
  description = "Name prefix (<product>-<env>)."
  type        = string
}

variable "application_log_group_name" {
  description = "CloudWatch log group of the API's application logs (App Runner: /aws/apprunner/<service>/<id>/application)."
  type        = string
}

variable "alerts_topic_arn" {
  description = "General alerts SNS topic (the observability module's topic). null = alarms exist but notify nobody."
  type        = string
  default     = null
}

variable "promotion_busy_threshold" {
  description = "PROMOTION_RESERVE_BUSY answers in 5 minutes before the alarm fires."
  type        = number
  default     = 20
}

variable "tags" {
  type    = map(string)
  default = {}
}
