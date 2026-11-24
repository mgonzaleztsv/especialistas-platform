const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const {
  buildStripeAccountCreationIdentity: build,
  matchesStripeAccountCreationIdentity: matches,
} = require('../dist/payments/stripe-account-creation-identity.js');

test('Stripe: identidad de conciliacion', async (t) => {
  const previousMode = process.env.STRIPE_MODE;

  try {
    process.env.STRIPE_MODE = 'test';

    const id = randomUUID();
    const otherId = randomUUID();
    const identity = build(id);

    await t.test('1 - Modo desactivado rechazado', () => {
      delete process.env.STRIPE_MODE;
      try {
        assert.throws(() => build(id));
        assert.throws(() => matches(id, identity));
      } finally {
        process.env.STRIPE_MODE = 'test';
      }
    });

    await t.test('2 - Modo real rechazado', () => {
      process.env.STRIPE_MODE = 'live';
      try {
        assert.throws(() => build(id));
        assert.throws(() => matches(id, identity));
      } finally {
        process.env.STRIPE_MODE = 'test';
      }
    });

    await t.test('3 - UUID invalidos rechazados', () => {
      for (const value of [
        null, undefined, '', 123, {}, [],
        'invalid', id.toUpperCase(),
        ' ' + id, id + ' ',
      ]) {
        assert.throws(() => build(value));
      }
    });

    await t.test('4 - Identidad determinista', () => {
      assert.deepEqual(build(id), identity);
    });

    await t.test('5 - Solicitudes independientes', () => {
      assert.notDeepEqual(build(otherId), identity);
    });

    await t.test('6 - Esquema correcto', () => {
      assert.equal(identity.connectpro_schema, 'v1');
    });

    await t.test('7 - Entorno correcto', () => {
      assert.equal(identity.connectpro_environment, 'test');
    });

    await t.test('8 - Operacion correcta', () => {
      assert.equal(
        identity.connectpro_operation,
        'connected-account-create'
      );
    });

    await t.test('9 - Solicitud correcta', () => {
      assert.equal(identity.connectpro_request, id);
    });

    await t.test('10 - Referencia determinista', () => {
      assert.match(
        identity.connectpro_reference,
        /^connectpro:test:v1:connected-account-create:[a-f0-9]{64}$/
      );
    });

    await t.test('11 - Identidad valida reconocida', () => {
      assert.equal(matches(id, identity), true);
    });

    await t.test('12 - Otra solicitud rechazada', () => {
      assert.equal(matches(otherId, identity), false);
    });

    await t.test('13 - Metadatos ausentes', () => {
      for (const value of [null, undefined, '', 1, [], {}]) {
        assert.equal(matches(id, value), false);
      }
    });

    await t.test('14 - Campos incompletos', () => {
      for (const key of Object.keys(identity)) {
        const copy = { ...identity };
        delete copy[key];
        assert.equal(matches(id, copy), false);
      }
    });

    await t.test('15 - Campos manipulados', () => {
      for (const key of Object.keys(identity)) {
        const copy = { ...identity, [key]: 'alterado' };
        assert.equal(matches(id, copy), false);
      }
    });

    await t.test('16 - Tipos incompatibles', () => {
      for (const key of Object.keys(identity)) {
        for (const value of [null, 1, true, {}, []]) {
          assert.equal(
            matches(id, { ...identity, [key]: value }),
            false
          );
        }
      }
    });

    await t.test('17 - Propiedades heredadas rechazadas', () => {
      assert.equal(
        matches(id, Object.create(identity)),
        false
      );
    });

    await t.test('18 - Getter no ejecutado', () => {
      const copy = { ...identity };
      let executed = false;

      Object.defineProperty(copy, 'connectpro_request', {
        get() {
          executed = true;
          return id;
        },
      });

      assert.equal(matches(id, copy), false);
      assert.equal(executed, false);
    });

    await t.test('19 - Metadatos adicionales permitidos', () => {
      assert.equal(
        matches(id, { ...identity, unrelated: 'value' }),
        true
      );
    });

    await t.test('20 - Solo cinco campos previstos', () => {
      assert.deepEqual(
        Object.keys(identity).sort(),
        [
          'connectpro_schema',
          'connectpro_environment',
          'connectpro_operation',
          'connectpro_request',
          'connectpro_reference',
        ].sort()
      );
    });

    await t.test('21 - Limites de metadatos', () => {
      for (const [key, value] of Object.entries(identity)) {
        assert.ok(key.length <= 40);
        assert.ok(value.length <= 500);
        assert.equal(typeof value, 'string');
      }
    });

    await t.test('22 - Identidad original conservada', () => {
      const copy = build(id);
      copy.connectpro_request = otherId;

      assert.equal(matches(id, copy), false);
      assert.deepEqual(build(id), identity);
    });

  } finally {
    if (previousMode === undefined) {
      delete process.env.STRIPE_MODE;
    } else {
      process.env.STRIPE_MODE = previousMode;
    }
  }
});
