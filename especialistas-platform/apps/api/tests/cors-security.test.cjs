const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { NestFactory } = require('@nestjs/core');
const { Module, Controller, Get } = require('@nestjs/common');

class HealthController {
  check() {
    return { ok: true };
  }
}

Controller('cors-test')(HealthController);
Get()(HealthController.prototype, 'check',
  Object.getOwnPropertyDescriptor(
    HealthController.prototype, 'check'
  ));

class TestModule {}
Module({
  controllers: [HealthController],
})(TestModule);

async function createApp() {
  const app = await NestFactory.create(TestModule, {
    logger: false,
    rawBody: true,
  });

  const allowed = new Set([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]);

  app.enableCors({
    origin: (origin, callback) => {
      callback(null, !origin || allowed.has(origin));
    },
    credentials: true,
  });

  await app.listen(0, '127.0.0.1');
  return app;
}

function request(port, origin) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (origin) headers.origin = origin;

    http.get({
      hostname: '127.0.0.1',
      port,
      path: '/cors-test',
      headers,
    }, res => {
      res.resume();
      res.on('end', () => resolve({
        status: res.statusCode,
        origin: res.headers['access-control-allow-origin'],
      }));
    }).on('error', reject);
  });
}

test('994: reglas CORS en NestJS', async () => {
  const app = await createApp();

  try {
    const port = app.getHttpServer().address().port;

    const allowed = await request(
      port, 'http://localhost:3000'
    );
    assert.equal(allowed.status, 200);
    assert.equal(
      allowed.origin, 'http://localhost:3000'
    );

    const blocked = await request(
      port, 'https://origen-no-autorizado.example'
    );
    assert.equal(blocked.origin, undefined);

    const internal = await request(port);
    assert.equal(internal.status, 200);

    console.log('CORRECTO - Origen permitido');
    console.log('CORRECTO - Origen desconocido sin autorización CORS');
    console.log('CORRECTO - Solicitud sin Origin');
  } finally {
    await app.close();
  }
});
