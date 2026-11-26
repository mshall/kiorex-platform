import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { buildOpenApi, setupApp } from './app.setup';
import { cfg } from './common/config';
import { installProcessSafetyNet } from './common/outbound-http';
import { installJobScheduler } from './common/job-scheduler';
import { logProviderStartup } from './common/providers/startup';
import { verifyLeadSigningStartup } from './partner-leads/partner-leads-public';
import { applyHttpHardening, assertProductionSecrets, corsOptions, swaggerEnabled } from './common/security';

async function bootstrap() {
  installProcessSafetyNet();
  installJobScheduler(); // before the app is created: wraps the services' setInterval timers (run on start, tick log, late-tick warning); JOBS_ENABLED=false installs nothing
  logProviderStartup(); // fail-fast: <KIND>_MODE=real without URL/credentials aborts startup (names only, never values)
  assertProductionSecrets(); // fail-fast: production never runs on the published dev secrets (names only)
  const lead = verifyLeadSigningStartup(); // fail-fast in production without PARTNER_LEAD_SIGNING_SECRET (variable name only, never the value)
  console.log(`lead signing: ${lead.status}`);
  const app = await NestFactory.create(AppModule, { rawBody: true });
  setupApp(app);
  applyHttpHardening(app); // security headers, no X-Powered-By, trust-proxy hops (TRUSTED_PROXY_HOPS)
  app.enableCors(corsOptions()); // allow-list (CORS_ORIGINS + configured product URLs), never a reflected Origin
  if (swaggerEnabled()) SwaggerModule.setup('api/docs', app, buildOpenApi(app)); // off in production unless SWAGGER_ENABLED=true
  await app.listen(cfg().port);
  // a malformed/reset client connection must never take the API down: answer 400 if still writable, otherwise drop it
  (app.getHttpServer() as import('http').Server).on('clientError', (err, socket) => {
    if (socket.writable && !socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); else socket.destroy();
  });
  console.log(`Kiorex API listening on :${cfg().port}/api/v1`);
}
// a failed start (missing production secret, bad provider mode, port in use, DB down) must END the process non-zero: the container then restarts and the health check never turns green
bootstrap().catch((e) => { console.error(`FATAL: the API failed to start: ${(e as Error)?.message ?? e}`); process.exit(1); });
