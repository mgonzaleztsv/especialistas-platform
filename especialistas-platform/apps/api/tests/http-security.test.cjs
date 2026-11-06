const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { NestFactory } = require('@nestjs/core');
const { Module } = require('@nestjs/common');
const { ThrottlerModule } = require('@nestjs/throttler');
const helmet = require('helmet');

const { AuthController } =
  require('../dist/auth/auth.controller.js');
const { AuthService } =
  require('../dist/auth/auth.service.js');

const authMock = {
  login: async () => ({ test: true }),
  register: async () => ({ test: true }),
};

class TestModule {}

Module({
  imports: [
    ThrottlerModule.forRoot([
      { ttl: 60000, limit: 5 }
    ]),
  ],
  controllers: [AuthController],
  providers: [
    { provide: AuthService, useValue: authMock },
  ],
})(TestModule);

function request(port, path) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from('{}');

    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': body.length,
      },
      timeout: 5000,
    }, res => {
      res.resume();
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
      }));
    });

    req.on('timeout', () =>
      req.destroy(new Error('Tiempo agotado'))
    );
    req.on('error', reject);
    req.end(body);
  });
}

test('1005: seguridad HTTP real', async () => {
  const app = await NestFactory.create(TestModule, {
    logger: false,
    rawBody: true,
  });

  app.use(helmet());
  app.setGlobalPrefix('api/v1');

  try {
    await app.listen(0, '127.0.0.1');
    const port = app.getHttpServer().address().port;

    const loginStatuses = [];

    for (let i = 0; i < 6; i++) {
      const response = await request(
        port, '/api/v1/auth/login'
      );
      loginStatuses.push(response.status);
    }

    assert.deepEqual(
      loginStatuses,
      [201, 201, 201, 201, 201, 429]
    );

    const register = await request(
      port, '/api/v1/auth/register'
    );

    assert.equal(register.status, 201);

    const helmetHeaders = await request(
      port, '/api/v1/auth/login'
    );

    assert.ok(
      helmetHeaders.headers['x-content-type-options']
    );

    assert.ok(
      helmetHeaders.headers['x-frame-options']
    );

    console.log('CORRECTO - Cinco solicitudes permitidas');
    console.log('CORRECTO - Sexta solicitud HTTP 429');
    console.log('CORRECTO - Registro con límite independiente');
    console.log('CORRECTO - Cabeceras Helmet presentes');
  } finally {
    await app.close();
  }
});
