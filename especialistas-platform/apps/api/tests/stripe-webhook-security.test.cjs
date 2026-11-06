const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BadRequestException,
  ServiceUnavailableException,
} = require('@nestjs/common');

const {
  StripeWebhookController,
} = require('../dist/payments/stripe-webhook.controller.js');

function setup() {
  const calls = { verify: 0, record: 0 };

  const event = {
    id: 'evt_connectpro_test_978',
    type: 'payment_intent.succeeded',
    livemode: false,
  };

  const verifier = {
    verify() {
      calls.verify++;
      return event;
    },
  };

  const registry = {
    async recordVerifiedEvent() {
      calls.record++;
      return {
        recorded: true,
        duplicate: false,
        status: 'RECEIVED',
      };
    },
  };

  return {
    controller: new StripeWebhookController(
      verifier,
      registry
    ),
    calls,
    verifier,
    registry,
    event,
  };
}

const payload = { rawBody: Buffer.from('{}') };
const signature = 'firma-simulada';

test('978.1: modo desactivado rechaza webhook', async () => {
  const previous = process.env.STRIPE_MODE;
  try {
    delete process.env.STRIPE_MODE;
    const s = setup();
    await assert.rejects(
      s.controller.receive(payload, signature),
      ServiceUnavailableException
    );
    assert.equal(s.calls.verify, 0);
    assert.equal(s.calls.record, 0);
  } finally {
    if (previous === undefined)
      delete process.env.STRIPE_MODE;
    else
      process.env.STRIPE_MODE = previous;
  }
});

test('978.2: falta contenido original', async () => {
  const s = setup();
  await assert.rejects(
    s.controller.receive({}, signature),
    BadRequestException
  );
  assert.equal(s.calls.verify, 0);
});

test('978.3: falta firma', async () => {
  const s = setup();
  await assert.rejects(
    s.controller.receive(payload, undefined),
    BadRequestException
  );
  assert.equal(s.calls.record, 0);
});

test('978.4: firma inválida', async () => {
  const s = setup();
  s.verifier.verify = () => {
    throw new Error('Firma inválida');
  };
  await assert.rejects(
    s.controller.receive(payload, signature),
    BadRequestException
  );
  assert.equal(s.calls.record, 0);
});

test('978.5: evento válido se registra', async () => {
  const s = setup();
  const result = await s.controller.receive(
    payload,
    signature
  );
  assert.deepEqual(result, { received: true });
  assert.equal(s.calls.verify, 1);
  assert.equal(s.calls.record, 1);
});

test('978.6: duplicado responde correctamente', async () => {
  const s = setup();
  s.registry.recordVerifiedEvent = async () => ({
    recorded: false,
    duplicate: true,
    status: 'RECEIVED',
  });
  const result = await s.controller.receive(
    payload,
    signature
  );
  assert.deepEqual(result, { received: true });
});

test('978.7: error de PostgreSQL no confirma recepción', async () => {
  const s = setup();
  s.registry.recordVerifiedEvent = async () => {
    throw new Error('PostgreSQL no disponible');
  };
  await assert.rejects(
    s.controller.receive(payload, signature),
    ServiceUnavailableException
  );
});

test('978.8: evento inválido conserva BadRequest', async () => {
  const s = setup();
  s.registry.recordVerifiedEvent = async () => {
    throw new BadRequestException('Evento inválido');
  };
  await assert.rejects(
    s.controller.receive(payload, signature),
    BadRequestException
  );
});
