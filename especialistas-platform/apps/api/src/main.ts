import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const apiEnv = resolve(process.cwd(), 'apps/api/.env');
const localApiEnv = resolve(process.cwd(), '.env');
const selectedEnv = existsSync(apiEnv) ? apiEnv : localApiEnv;

loadEnv({ path: selectedEnv, override: false });

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = Number(process.env.API_PORT || 3001);
  await app.listen(port, '0.0.0.0');
  console.log(`API lista en http://localhost:${port}/api/v1`);
}
bootstrap();
