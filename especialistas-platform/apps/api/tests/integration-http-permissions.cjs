'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const { URL } = require('node:url');
const { PrismaClient } = require('@prisma/client');
const { Test } = require('@nestjs/testing');

async function main() {
  assert.equal(process.env.CONNECTPRO_HTTP_TEST, 'true');

  const url = new URL(process.env.DATABASE_URL || '');
  assert.equal(url.protocol, 'postgresql:');
  assert.equal(url.hostname, 'localhost');
  assert.equal(url.port, '5433');
  assert.equal(url.pathname, '/connectpro_test');
  assert.equal(url.username, 'connectpro_test');

  const secret = process.env.JWT_SECRET;
  assert.ok(secret && secret.length >= 32);
  assert.notEqual(secret, 'dev-secret');

  const prisma = new PrismaClient();
  let app;

  try {
    const database = await prisma.$queryRaw`
      SELECT current_database() AS name
    `;
    assert.equal(database[0].name, 'connectpro_test');

    const owner = await prisma.user.findUnique({
      where: { email: 'cliente.integration@connectpro.test' },
      include: { client: true }
    });

    const outsider = await prisma.user.findUnique({
      where: { email: 'cliente.ajeno@connectpro.test' },
      include: { client: true }
    });

    assert.ok(owner?.client);
    assert.ok(outsider?.client);
    assert.notEqual(owner.id, outsider.id);

    const job = await prisma.jobRequest.findUnique({
      where: {
        id: 'b0e9828b-b293-47a5-93fe-468c6d289f80'
      }
    });

    assert.ok(job);
    assert.equal(job.clientId, owner.client.id);

    const { AppModule } = require('../dist/app.module.js');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');

    await app.init();
    await app.listen(0, '127.0.0.1');

    const port = app.getHttpServer().address().port;

    function get(path, token) {
      return new Promise((resolve, reject) => {
        const req = http.get({
          hostname: '127.0.0.1',
          port,
          path,
          headers: {
            Authorization: 'Bearer ' + token
          }
        }, response => {
          let body = '';
          response.on('data', chunk => body += chunk);
          response.on('end', () => {
            resolve({
              status: response.statusCode,
              body
            });
          });
        });

        req.on('error', reject);
      });
    }

    function tokenFor(user) {
      return jwt.sign({
        sub: user.id,
        role: user.role
      }, secret, {
        expiresIn: '10m'
      });
    }

    const path = `/api/v1/job-requests/${job.id}/proposals`;

    const authorized = await get(path, tokenFor(owner));
    assert.equal(
      authorized.status,
      200,
      'El propietario debe tener acceso'
    );
    const proposals = JSON.parse(authorized.body);
    assert.ok(Array.isArray(proposals));
    assert.ok(proposals.length > 0);

    console.log('CORRECTO - Propietario autorizado: HTTP 200');

    const denied = await get(path, tokenFor(outsider));

    assert.equal(
      denied.status,
      403,
      'El cliente ajeno debe recibir HTTP 403'
    );

    console.log(
      'CORRECTO - Cliente ajeno rechazado: HTTP ' +
      denied.status
    );

    console.log('===== PASO 438 COMPLETADO =====');
  } finally {
    if (app) await app.close();
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('ERROR:', error.message);
  process.exitCode = 1;
});
