# Contract: cdn_edge. CloudFront, OAC, Function (SPA rewrite), /api/* behaviour -> App Runner service_url.
# CDK: cloudfront.Distribution + Function + origin-host-parser Lambda (retired: service_url is a plain attribute).

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

data "aws_cloudfront_response_headers_policy" "security" {
  name = "Managed-SecurityHeadersPolicy"
}

locals {
  s3_origin_id  = "web-s3"
  api_origin_id = "api-apprunner"
  api_host      = trimsuffix(trimprefix(trimprefix(var.api_origin_domain, "https://"), "http://"), "/")

  # GRW-P1-E public site role
  site_separate_origin = var.site_enabled && var.site_origin_domain != null
  site_origin_id       = local.site_separate_origin ? "site-role" : local.api_origin_id
  site_host            = var.site_origin_domain == null ? local.api_host : trimsuffix(trimprefix(trimprefix(var.site_origin_domain, "https://"), "http://"), "/")
  # HTML and sitemaps: cached on the path only (query whitelist page, sort), the origin sends s-maxage and stale-while-revalidate
  site_cached_paths = ["/ar/*", "/en/*", "/robots.txt", "/sitemap.xml", "/sitemaps/*", "/.well-known/*"]
}

# Cache key = path only plus the two content query keys (ARCH section 5): no cookies, no Accept-Language, no Authorization, so one object serves everyone
# and a private value can never be cached. The origin Cache-Control decides the lifetime (s-maxage 300, stale-while-revalidate 3600).
resource "aws_cloudfront_cache_policy" "site_html" {
  count       = var.site_enabled ? 1 : 0
  name        = "${var.name}-site-html"
  comment     = "Public SSR pages: path + page/sort query only"
  min_ttl     = 0
  default_ttl = 300
  max_ttl     = 86400

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    headers_config {
      header_behavior = "none"
    }
    cookies_config {
      cookie_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "whitelist"
      query_strings {
        items = ["page", "sort"]
      }
    }
  }
}

# Legacy /doctors/:id: the 301 target locale is negotiated from kx-lang and Accept-Language, so those reach the origin (the answer is never cached: private, no-cache).
resource "aws_cloudfront_origin_request_policy" "site_legacy" {
  count   = var.site_enabled ? 1 : 0
  name    = "${var.name}-site-legacy-doctors"
  comment = "Forward Accept-Language, the kx-lang cookie and the query string to the site role"

  headers_config {
    header_behavior = "whitelist"
    headers {
      items = ["Accept-Language"]
    }
  }
  cookies_config {
    cookie_behavior = "whitelist"
    cookies {
      items = ["kx-lang"]
    }
  }
  query_strings_config {
    query_string_behavior = "all"
  }
}

# SPA default behaviour: equivalent of Managed-SecurityHeadersPolicy plus X-Robots-Tag noindex and the ADR-038 frame ban.
resource "aws_cloudfront_response_headers_policy" "spa" {
  count   = var.spa_noindex_header ? 1 : 0
  name    = "${var.name}-spa-noindex"
  comment = "SPA is never indexed (public pages are SSR under /{ar,en}/{cc}/); never framed (ADR-038)"

  security_headers_config {
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      override                   = true
    }
  }

  custom_headers_config {
    items {
      header   = "X-Robots-Tag"
      value    = "noindex, nofollow"
      override = true
    }
  }
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.name}-web-oac"
  description                       = "OAC for ${var.name} web bucket (S3 is never public)"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# SPA deep links: serve index.html for paths without a file extension; leave /api/* unchanged.
# Do NOT use distribution-wide custom error responses - they would rewrite API JSON errors to HTML.
resource "aws_cloudfront_function" "spa_rewrite" {
  name    = "${var.name}-spa-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "SPA deep links: index.html for extension-less paths; /api/* untouched"
  publish = true
  code    = <<-EOT
    function handler(event) {
      var request = event.request;
      var uri = request.uri || "";
      if (uri.startsWith("/api")) {
        return request;
      }
      if (uri.indexOf(".") !== -1) {
        return request;
      }
      request.uri = "/index.html";
      return request;
    }
  EOT
}

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = var.comment
  default_root_object = "index.html"
  price_class         = var.price_class
  http_version        = "http2and3"
  aliases             = var.aliases
  web_acl_id          = var.web_acl_arn

  origin {
    origin_id                = local.s3_origin_id
    domain_name              = var.web_bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  origin {
    origin_id   = local.api_origin_id
    domain_name = local.api_host
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  dynamic "origin" {
    for_each = local.site_separate_origin ? [1] : []
    content {
      origin_id   = local.site_origin_id
      domain_name = local.site_host
      custom_origin_config {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "https-only"
        origin_ssl_protocols   = ["TLSv1.2"]
      }
    }
  }

  default_cache_behavior {
    target_origin_id           = local.s3_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD", "OPTIONS"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = var.spa_noindex_header ? aws_cloudfront_response_headers_policy.spa[0].id : data.aws_cloudfront_response_headers_policy.security.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_rewrite.arn
    }
  }

  # New deploys visible immediately; build id drives client refresh.
  ordered_cache_behavior {
    path_pattern               = "/build-id.json"
    target_origin_id           = local.s3_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD", "OPTIONS"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
  }

  ordered_cache_behavior {
    path_pattern               = "/index.html"
    target_origin_id           = local.s3_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD", "OPTIONS"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
  }

  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = local.api_origin_id
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
  }

  # GRW-P1-E: public SSR namespaces. The site role sends its own security headers (CSP frame-ancestors 'none'), so no response headers policy here.
  dynamic "ordered_cache_behavior" {
    for_each = var.site_enabled ? local.site_cached_paths : []
    content {
      path_pattern           = ordered_cache_behavior.value
      target_origin_id       = local.site_origin_id
      viewer_protocol_policy = "redirect-to-https"
      allowed_methods        = ["GET", "HEAD", "OPTIONS"]
      cached_methods         = ["GET", "HEAD", "OPTIONS"]
      compress               = true
      cache_policy_id        = aws_cloudfront_cache_policy.site_html[0].id
    }
  }

  # hashed public client assets (immutable, served by the site role under /_p/)
  dynamic "ordered_cache_behavior" {
    for_each = var.site_enabled ? ["/_p/*"] : []
    content {
      path_pattern           = ordered_cache_behavior.value
      target_origin_id       = local.site_origin_id
      viewer_protocol_policy = "redirect-to-https"
      allowed_methods        = ["GET", "HEAD", "OPTIONS"]
      cached_methods         = ["GET", "HEAD", "OPTIONS"]
      compress               = true
      cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
    }
  }

  # legacy SPA URL /doctors/:id: 301 to the slug URL (or the SPA shell) from the site role; never cached at the edge
  dynamic "ordered_cache_behavior" {
    for_each = var.site_enabled ? ["/doctors/*"] : []
    content {
      path_pattern             = ordered_cache_behavior.value
      target_origin_id         = local.site_origin_id
      viewer_protocol_policy   = "redirect-to-https"
      allowed_methods          = ["GET", "HEAD", "OPTIONS"]
      cached_methods           = ["GET", "HEAD"]
      compress                 = true
      cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
      origin_request_policy_id = aws_cloudfront_origin_request_policy.site_legacy[0].id
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.certificate_arn == null
    acm_certificate_arn            = var.certificate_arn
    ssl_support_method             = var.certificate_arn == null ? null : "sni-only"
    minimum_protocol_version       = var.certificate_arn == null ? null : "TLSv1.2_2021"
  }

  tags = var.tags
}
