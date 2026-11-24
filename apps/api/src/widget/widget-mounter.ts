import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Express } from 'express';
import { EmbedHandlers } from './embed.controller';
import { widgetCfg } from './widget.config';

/**
 * Mounts the widget host routes at the host root (Nest serves /api/v1 under the global prefix; the embed URL, SDK and callback have fixed root paths that providers paste
 * into their sites). `WIDGET_HOST` restricts them to the dedicated widget host; the same API image serves both hosts (ADR-043 pattern, like the public site role).
 *   GET /v1/embed/:orgSlug            the iframe document (CSP frame-ancestors = the organisation's exact origins, else 'none')
 *   GET /v1/embed/assets/:file        hashed app files (immutable)        GET /v1/embed/auth/callback   Passport popup return page
 *   GET /v1/sdk.js | /v1/<hash>/sdk.js | /v1/sdk.json                      GET /v1/sandbox?org=<slug>    demo page
 */
@Injectable()
export class WidgetMounter implements OnModuleInit {
  private readonly log = new Logger('widget');
  constructor(private readonly host: HttpAdapterHost, private readonly h: EmbedHandlers) {}
  onModuleInit(): void {
    const app = this.host.httpAdapter?.getInstance() as Express | undefined;
    if (!widgetCfg().enabled || !app || typeof app.get !== 'function') { this.log.log('widget host not mounted'); return; }
    app.get('/v1/embed/auth/callback', this.h.callback);
    app.get('/v1/embed/assets/:file', this.h.asset);
    app.get('/v1/embed/:orgSlug', this.h.shell);
    app.get('/v1/sdk.js', this.h.sdk(false));
    app.get('/v1/sdk.json', this.h.sdkInfo);
    app.get(/^\/v1\/([a-f0-9]{16})\/sdk\.js$/, this.h.sdk(true));
    app.get('/v1/sandbox', this.h.sandbox);
    this.log.log(`widget host mounted (host=${widgetCfg().host || 'any (development)'})`);
  }
}
