import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { buildOpenApi, setupApp } from './app.setup';
import { cfg } from './common/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  setupApp(app);
  app.enableCors({ origin: true, credentials: true });
  SwaggerModule.setup('api/docs', app, buildOpenApi(app));
  await app.listen(cfg().port);
  console.log(`Kiorex API listening on :${cfg().port}/api/v1`);
}
void bootstrap();
