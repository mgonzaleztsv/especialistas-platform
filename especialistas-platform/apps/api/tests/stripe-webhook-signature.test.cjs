const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Stripe = require('stripe');

const {
  StripeWebhookVerifierService,
} = require('../dist/payments/stripe-webhook-verifier.service.js');

const verifier = new StripeWebhookVerifierService();
const secret = 'whsec_connectpro_local_test_979';
const event = {
  id: 'evt_connectpro_979',
  object: 'event',
  type: 'payment_intent.succeeded',
  livemode: false,
  data: { object: { id: 'pi_connectpro_979' } },
};

const payload = Buffer.from(JSON.stringify(event));

function sign(body, timestamp = Math.floor(Date.now() / 1000)) {
  return Stripe.webhooks.generateTestHeaderString({
    payload: body.toString('utf8'),
    secret,
    timestamp,
  });
}

function prepare() {
  process.env.STRIPE_MODE = 'test';
  process.env.STRIPE_WEBHOOK_SECRET = secret;
}

const previousMode = process.env.STRIPE_MODE;
const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;

test.after(() => {
  if (previousMode === undefined)
    delete process.env.STRIPE_MODE;
  else
    process.env.STRIPE_MODE = previousMode;

  if (previousSecret === undefined)
    delete process.env.STRIPE_WEBHOOK_SECRET;
  else
    process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
});

test('979.1: firma auténtica aceptada', () => {
  prepare();
  const result = verifier.verify(payload, sign(payload));
  assert.equal(result.id, event.id);
  assert.equal(result.livemode, false);
});

test('979.2: firma alterada rechazada', () => {
  prepare();
  const header = sign(payload);
  const invalid = header.replace(/v1=[a-f0-9]+/, 'v1=' + '0'.repeat(64));
  assert.throws(() => verifier.verify(payload, invalid));
});

test('979.3: mensaje modificado rechazado', () => {
  prepare();
  const signature = sign(payload);
  const modified = Buffer.from(
    payload.toString().replace(
      'payment_intent.succeeded',
      'payment_intent.failed'
    )
  );
  assert.throws(() => verifier.verify(modified, signature));
});

test('979.4: sin secreto no verifica', () => {
  prepare();
  delete process.env.STRIPE_WEBHOOK_SECRET;
  assert.throws(() => verifier.verify(payload, sign(payload)));
});

test('979.5: modo producción bloqueado', () => {
  prepare();
  process.env.STRIPE_MODE = 'live';
  assert.throws(() => verifier.verify(payload, sign(payload)));
});

test('979.6: firma caducada rechazada', () => {
  prepare();
  const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
  assert.throws(() =>
    verifier.verify(payload, sign(payload, oldTimestamp))
  );
});
