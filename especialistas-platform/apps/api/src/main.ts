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
  const configuredOrigins = (
    process.env.CORS_ORIGINS || ''
  )
    .split(',')
    .map((origin: string) => origin.trim())
    .filter(Boolean);

  const allowedOrigins = new Set<string>(configuredOrigins);

  if (process.env.NODE_ENV === 'production') {
    if (allowedOrigins.size === 0) {
      throw new Error(
        'CORS_ORIGINS debe configurarse en producción'
      );
    }
  } else {
    allowedOrigins.add('http://localhost:3000');
    allowedOrigins.add('http://127.0.0.1:3000');

    const codespace = process.env.CODESPACE_NAME;
    const domain =
      process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;

    if (codespace && domain) {
      allowedOrigins.add(
        `https://${codespace}-3000.${domain}`
      );
    }
  }

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void
    ) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = Number(process.env.API_PORT || 3001);
  await app.listen(port, '0.0.0.0');
  console.log(`API lista en http://localhost:${port}/api/v1`);
}
bootstrap();
