import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { buildOpenApi, setupApp } from './app.setup';
import { cfg } from './common/config';
import { installProcessSafetyNet } from './common/outbound-http';

async function bootstrap() {
  installProcessSafetyNet();
  const app = await NestFactory.create(AppModule, { rawBody: true });
  setupApp(app);
  app.enableCors({ origin: true, credentials: true });
  SwaggerModule.setup('api/docs', app, buildOpenApi(app));
  await app.listen(cfg().port);
  // a malformed/reset client connection must never take the API down: answer 400 if still writable, otherwise drop it
  (app.getHttpServer() as import('http').Server).on('clientError', (err, socket) => {
    if (socket.writable && !socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); else socket.destroy();
  });
  console.log(`Kiorex API listening on :${cfg().port}/api/v1`);
}
void bootstrap();
