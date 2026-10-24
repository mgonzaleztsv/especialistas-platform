'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { URL } = require('node:url');
const { Test } = require('@nestjs/testing');

async function main() {
  assert.equal(process.env.CONNECTPRO_HTTP_TEST, 'true');

  const url = new URL(process.env.DATABASE_URL || '');
  assert.equal(url.protocol, 'postgresql:');
  assert.equal(url.hostname, 'localhost');
  assert.equal(url.port, '5433');
  assert.equal(url.pathname, '/connectpro_test');
  assert.equal(url.username, 'connectpro_test');

  assert.ok(process.env.JWT_SECRET);
  assert.ok(process.env.JWT_SECRET.length >= 32);
  assert.notEqual(process.env.JWT_SECRET, 'dev-secret');

  const { AppModule } = require('../dist/app.module.js');

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule]
  }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');

  try {
    await app.init();
    await app.listen(0, '127.0.0.1');

    const address = app.getHttpServer().address();
    const port = address.port;

    function request(token) {
      return new Promise((resolve, reject) => {
        const headers = token
          ? { Authorization: 'Bearer ' + token }
          : {};

        const req = http.get({
          hostname: '127.0.0.1',
          port,
          path: '/api/v1/job-requests/me',
          headers
        }, res => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        });

        req.on('error', reject);
      });
    }

    const withoutToken = await request(null);
    assert.equal(withoutToken, 401);
    console.log('CORRECTO - Sin token: HTTP 401');

    const invalidToken = await request('token-falso');
    assert.equal(invalidToken, 401);
    console.log('CORRECTO - Token falso: HTTP 401');

    console.log('===== PASO 437 COMPLETADO =====');
  } finally {
    await app.close();
  }
}

main().catch(error => {
  console.error('ERROR:', error.message);
  process.exitCode = 1;
});
