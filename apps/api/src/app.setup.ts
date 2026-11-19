import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/errors';

export const API_PREFIX = 'api/v1';

export function setupApp(app: INestApplication) {
  app.setGlobalPrefix(API_PREFIX);
  // vault uploads are JSON/base64 (<= VAULT_MAX_BYTES 5 MB => ~6.7 MB); rawBody (webhook HMAC) is preserved by Nest's parser options
  (app as unknown as { useBodyParser?: (t: string, o: object) => void }).useBodyParser?.('json', { limit: '8mb' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
  app.useGlobalFilters(new AllExceptionsFilter());
  return app;
}

/**
 * Query parameters that are genuinely mandatory. `@Query('x') x?: string` carries no optionality metadata, so without this
 * Nest swagger marks EVERY inline query param required:true (which broke generated clients). Anything not listed is optional.
 */
export const REQUIRED_QUERY_PARAMS: Record<string, string[]> = {
  'get /api/v1/rx/verify': ['t'],
  'get /api/v1/control/v1/flags/snapshot': ['product'],
  'get /api/v1/dev/channels/whatsapp/conversation': ['phone'],
  'get /api/v1/providers/{id}/slots': ['typeId'],
  'get /api/v1/lab/slots': ['labId'],
};

export function buildOpenApi(app: INestApplication) {
  const cfgDoc = new DocumentBuilder()
    .setTitle('Kiorex API').setDescription('Kiorex marketplace API. Identity: Kiorex Passport (OIDC). Errors: { code, message, ...extra }. Flag OFF => 403 FEATURE_DISABLED {key, scope}.')
    .setVersion('1.0.0').addBearerAuth().build();
  const doc = SwaggerModule.createDocument(app, cfgDoc);
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item as Record<string, any>)) {
      const required = REQUIRED_QUERY_PARAMS[`${method} ${path}`] ?? [];
      for (const prm of op?.parameters ?? []) if (prm.in === 'query') prm.required = required.includes(prm.name);
    }
  }
  return doc;
}
