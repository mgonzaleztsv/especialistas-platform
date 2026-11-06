const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const {
  StripeEventRegistryService,
} = require('../dist/payments/stripe-event-registry.service.js');

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');

if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.port !== '5433' ||
  url.pathname !== '/connectpro_test'
) {
  throw Error('ALTO: Se requiere connectpro_test en puerto 5433');
}

if (process.env.STRIPE_MODE !== 'test') {
  throw Error('ALTO: STRIPE_MODE debe ser test');
}

test('983: concurrencia real de eventos Stripe', async () => {
  const prisma = new PrismaClient();
  const registry = new StripeEventRegistryService(prisma);

  const id = 'evt_connectpro_983_' +
    crypto.randomBytes(12).toString('hex');

  const event = {
    id,
    type: 'payment_intent.succeeded',
    livemode: false,
  };

  try {
    await prisma.$connect();

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        registry.recordVerifiedEvent(event)
      )
    );

    assert.equal(
      results.filter(r => r.recorded).length,
      1,
      'Debe registrarse exactamente una vez'
    );

    assert.equal(
      results.filter(r => r.duplicate).length,
      11,
      'Once entregas deben reconocerse como duplicadas'
    );

    const rows = await prisma.stripeWebhookEvent.findMany({
      where: { stripeEventId: id },
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'RECEIVED');
    assert.equal(rows[0].livemode, false);

    console.log('CORRECTO - 12 entregas concurrentes');
    console.log('CORRECTO - 1 evento registrado');
    console.log('CORRECTO - 11 duplicados reconocidos');
    console.log('CORRECTO - Estado RECEIVED');
  } finally {
    try {
      await prisma.stripeWebhookEvent.deleteMany({
        where: { stripeEventId: id },
      });
      console.log('CORRECTO - Registros de prueba eliminados');
    } finally {
      await prisma.$disconnect();
    }
  }
});
