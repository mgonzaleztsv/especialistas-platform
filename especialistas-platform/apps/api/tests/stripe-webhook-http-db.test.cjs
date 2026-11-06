const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const Stripe = require('stripe');
const { NestFactory } = require('@nestjs/core');
const { Module } = require('@nestjs/common');
const { PrismaClient } = require('@prisma/client');
const { StripeWebhookController } =
  require('../dist/payments/stripe-webhook.controller.js');
const { StripeWebhookVerifierService } =
  require('../dist/payments/stripe-webhook-verifier.service.js');
const { StripeEventRegistryService } =
  require('../dist/payments/stripe-event-registry.service.js');

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');

if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.port !== '5433' ||
  url.pathname !== '/connectpro_test' ||
  process.env.STRIPE_MODE !== 'test'
) {
  throw Error('ALTO: Se requiere PostgreSQL aislado y STRIPE_MODE=test');
}

const secret = 'whsec_connectpro_http_test_986';
process.env.STRIPE_WEBHOOK_SECRET = secret;

const prisma = new PrismaClient();

const registry = new StripeEventRegistryService(prisma);
const verifier = new StripeWebhookVerifierService();

class TestModule {}
Module({
  controllers: [StripeWebhookController],
  providers: [
    { provide: StripeWebhookVerifierService, useValue: verifier },
    { provide: StripeEventRegistryService, useValue: registry },
  ],
})(TestModule);

function post(port, body, signature) {
  return new Promise((resolve, reject) => {
    const headers = {
      'content-type': 'application/json',
      'content-length': body.length,
    };
    if (signature !== undefined)
      headers['stripe-signature'] = signature;

    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/payments/stripe/webhook',
      method: 'POST',
      headers,
      timeout: 5000,
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });

    req.on('timeout', () =>
      req.destroy(new Error('Tiempo HTTP agotado'))
    );
    req.on('error', reject);
    req.end(body);
  });
}

test('986: webhook HTTP real y PostgreSQL aislado', async () => {
  const id = 'evt_connectpro_http_' +
    crypto.randomBytes(12).toString('hex');

  const event = {
    id,
    object: 'event',
    type: 'payment_intent.succeeded',
    livemode: false,
    data: { object: { id: 'pi_connectpro_test_986' } },
  };

  const body = Buffer.from(JSON.stringify(event));
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload: body.toString('utf8'),
    secret,
  });

  let app;

  try {
    await prisma.$connect();

    app = await NestFactory.create(TestModule, {
      rawBody: true,
      logger: false,
    });
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');

    const port = app.getHttpServer().address().port;

    const valid = await post(port, body, signature);
    assert.equal(valid.status, 200, valid.body);
    assert.deepEqual(JSON.parse(valid.body), { received: true });

    const duplicate = await post(port, body, signature);
    assert.equal(duplicate.status, 200, duplicate.body);

    const invalid = await post(
      port, body, 't=123,v1=' + '0'.repeat(64)
    );
    assert.equal(invalid.status, 400, invalid.body);

    const missing = await post(port, body, undefined);
    assert.equal(missing.status, 400, missing.body);

    const records = await prisma.stripeWebhookEvent.findMany({
      where: { stripeEventId: id },
    });

    assert.equal(records.length, 1);
    assert.equal(records[0].status, 'RECEIVED');

    console.log('CORRECTO - Firma válida: HTTP 200');
    console.log('CORRECTO - Duplicado: HTTP 200');
    console.log('CORRECTO - Firma inválida: HTTP 400');
    console.log('CORRECTO - Firma ausente: HTTP 400');
    console.log('CORRECTO - Un solo registro persistido');
  } finally {
    if (app) await app.close();
    try {
      await prisma.stripeWebhookEvent.deleteMany({
        where: { stripeEventId: id },
      });
      console.log('CORRECTO - Registro temporal eliminado');
    } finally {
      await prisma.$disconnect();
    }
  }
});
