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

export function buildOpenApi(app: INestApplication) {
  const cfgDoc = new DocumentBuilder()
    .setTitle('Kiorex API').setDescription('Kiorex marketplace API. Identity: Kiorex Passport (OIDC). Errors: { code, message, ...extra }. Flag OFF => 403 FEATURE_DISABLED {key, scope}.')
    .setVersion('1.0.0').addBearerAuth().build();
  return SwaggerModule.createDocument(app, cfgDoc);
}
