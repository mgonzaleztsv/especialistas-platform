const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const {
  buildStripeAccountCreationParams: build,
} = require('../dist/payments/stripe-account-creation-params.js');

const {
  buildStripeAccountCreationIdentity: identity,
} = require('../dist/payments/stripe-account-creation-identity.js');

test('Stripe: parametros seguros de creacion', async (t) => {
  const previousMode = process.env.STRIPE_MODE;

  try {
    process.env.STRIPE_MODE = 'test';

    const requestId = randomUUID();
    const expected = identity(requestId);
    const key = expected.connectpro_reference;

    const valid = () => build(requestId, 'MX', key);

    await t.test('1 - Modo ausente bloqueado', () => {
      delete process.env.STRIPE_MODE;
      try {
        assert.throws(valid);
      } finally {
        process.env.STRIPE_MODE = 'test';
      }
    });

    await t.test('2 - Modo desactivado bloqueado', () => {
      process.env.STRIPE_MODE = 'disabled';
      try {
        assert.throws(valid);
      } finally {
        process.env.STRIPE_MODE = 'test';
      }
    });

    await t.test('3 - Modo real bloqueado', () => {
      process.env.STRIPE_MODE = 'live';
      try {
        assert.throws(valid);
      } finally {
        process.env.STRIPE_MODE = 'test';
      }
    });

    await t.test('4 - Modo desconocido bloqueado', () => {
      process.env.STRIPE_MODE = 'unknown';
      try {
        assert.throws(valid);
      } finally {
        process.env.STRIPE_MODE = 'test';
      }
    });

    await t.test('5 - Solicitudes invalidas', () => {
      for (const value of [
        null, undefined, '', 'invalid', 123,
        requestId.toUpperCase(),
      ]) {
        assert.throws(() => build(value, 'MX', key));
      }
    });

    await t.test('6 - Paises invalidos', () => {
      for (const value of [
        null, undefined, '', 'MEX', 'mx',
        ' MX', 'MX ', '12', 123,
      ]) {
        assert.throws(() => build(requestId, value, key));
      }
    });

    await t.test('7 - Clave ausente', () => {
      for (const value of [null, undefined, '']) {
        assert.throws(
          () => build(requestId, 'MX', value)
        );
      }
    });

    await t.test('8 - Clave manipulada', () => {
      assert.throws(
        () => build(requestId, 'MX', key + 'x')
      );
    });

    await t.test('9 - Clave de otra solicitud', () => {
      const another = identity(randomUUID());

      assert.throws(
        () => build(
          requestId, 'MX',
          another.connectpro_reference
        )
      );
    });

    await t.test('10 - Pais conservado', () => {
      for (const country of ['MX', 'ES', 'US']) {
        assert.equal(
          build(requestId, country, key).params.country,
          country
        );
      }
    });

    await t.test('11 - Metadatos exactos', () => {
      assert.deepEqual(valid().params.metadata, expected);
    });

    await t.test('12 - Cinco campos de identidad', () => {
      assert.equal(
        Object.keys(valid().params.metadata).length,
        5
      );
    });

    await t.test('13 - Idempotencia exacta', () => {
      assert.equal(valid().options.idempotencyKey, key);
    });

    await t.test('14 - Reintentos desactivados', () => {
      assert.equal(valid().options.maxNetworkRetries, 0);
    });

    await t.test('15 - Tiempo limite exacto', () => {
      assert.equal(valid().options.timeout, 20000);
    });

    await t.test('16 - Panel Express provisional', () => {
      assert.equal(
        valid().params.controller.stripe_dashboard.type,
        'express'
      );
    });

    await t.test('17 - Comisiones de plataforma', () => {
      assert.equal(
        valid().params.controller.fees.payer,
        'application'
      );
    });

    await t.test('18 - Responsabilidad provisional', () => {
      assert.equal(
        valid().params.controller.losses.payments,
        'application'
      );
    });

    await t.test('19 - Verificacion administrada por Stripe', () => {
      assert.equal(
        valid().params.controller.requirement_collection,
        'stripe'
      );
    });

    await t.test('20 - Sin capacidades explicitas', () => {
      assert.ok(!('capabilities' in valid().params));
    });

    await t.test('21 - Sin informacion bancaria', () => {
      assert.ok(!('external_account' in valid().params));
    });

    await t.test('22 - Sin datos personales ni contratos', () => {
      const params = valid().params;

      for (const field of [
        'email', 'individual', 'company',
        'documents', 'account_token',
        'tos_acceptance', 'business_profile',
      ]) {
        assert.ok(!(field in params));
      }
    });

    await t.test('23 - Solo parametros autorizados', () => {
      const result = valid();

      assert.deepEqual(
        Object.keys(result.params).sort(),
        ['controller', 'country', 'metadata']
      );

      assert.deepEqual(
        Object.keys(result.options).sort(),
        ['idempotencyKey', 'maxNetworkRetries', 'timeout']
      );

      assert.deepEqual(
        result.params.controller,
        {
          fees: { payer: 'application' },
          losses: { payments: 'application' },
          requirement_collection: 'stripe',
          stripe_dashboard: { type: 'express' },
        }
      );
    });

    await t.test('24 - Parametros deterministas', () => {
      assert.deepEqual(valid(), valid());
    });

    await t.test('25 - Resultados independientes', () => {
      const first = valid();
      const second = valid();

      first.params.metadata.connectpro_request = 'alterado';
      first.params.controller.fees.payer = 'alterado';
      first.options.timeout = 1;

      assert.deepEqual(second, valid());
      assert.equal(
        second.params.metadata.connectpro_request,
        requestId
      );
    });

  } finally {
    if (previousMode === undefined) {
      delete process.env.STRIPE_MODE;
    } else {
      process.env.STRIPE_MODE = previousMode;
    }
  }
});
