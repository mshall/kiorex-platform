variable "name" {
  description = "Name prefix."
  type        = string
}

variable "comment" {
  description = "Distribution comment."
  type        = string
}

variable "web_bucket_regional_domain_name" {
  description = "Web bucket regional domain name."
  type        = string
}

variable "api_origin_domain" {
  description = "API origin host: App Runner service_url (scheme is stripped if present)."
  type        = string
}

variable "aliases" {
  description = "Custom domain names (CNAMEs)."
  type        = list(string)
  default     = []
}

variable "certificate_arn" {
  description = "ACM certificate ARN in us-east-1 (null = CloudFront default certificate)."
  type        = string
  default     = null
}

variable "web_acl_arn" {
  description = "WAFv2 web ACL ARN (CLOUDFRONT scope). null = none."
  type        = string
  default     = null
}

variable "price_class" {
  description = "CloudFront price class."
  type        = string
  default     = "PriceClass_100"
}

variable "tags" {
  description = "Tags merged onto every resource."
  type        = map(string)
  default     = {}
}

# GRW-P1-E: public SEO site role. OFF by default so existing plans do not change. The site role is the SAME Kiorex API image (SITE_ROLE=all|site):
# by default it shares the API origin, and a later split into its own service only sets site_origin_domain.
variable "site_enabled" {
  description = "Route the public SSR namespaces (/ar/*, /en/*, /robots.txt, /sitemap.xml, /sitemaps/*, /.well-known/*, /_p/*, legacy /doctors/*) to the site role."
  type        = bool
  default     = false
}

variable "site_origin_domain" {
  description = "Origin host of a separate site-role service. null = the API origin (single service, role all)."
  type        = string
  default     = null
}

variable "spa_noindex_header" {
  description = "Send X-Robots-Tag: noindex, nofollow (and the ADR-038 frame ban) on the SPA default behaviour. Replaces the managed security-headers policy with an equivalent custom one."
  type        = bool
  default     = false
}
