const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const {
  validateStripeAccountCreationResponse: validate,
} = require('../dist/payments/stripe-account-creation-response.js');

const {
  buildStripeAccountCreationIdentity: identity,
} = require('../dist/payments/stripe-account-creation-identity.js');

test('Stripe: validacion segura de respuestas', async (t) => {
  const previousMode = process.env.STRIPE_MODE;

  try {
    process.env.STRIPE_MODE = 'test';

    const requestId = randomUUID();
    const country = 'MX';
    const accountId = 'acct_TestResponse123';

    function fixture() {
      return {
        id: accountId,
        object: 'account',
        country,
        livemode: false,
        deleted: false,
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
        metadata: identity(requestId),
      };
    }

    function inspect(response) {
      return validate(requestId, country, response);
    }

    function reject(change) {
      const response = fixture();
      change(response);
      assert.equal(inspect(response), null);
    }

    const expected = {
      stripeAccountId: accountId,
      country,
      livemode: false,
    };

    for (const [index, mode] of [
      undefined, 'disabled', 'live', 'unknown',
    ].entries()) {
      await t.test(
        `${index + 1} - Modo incompatible: ${mode}`,
        () => {
          const response = fixture();

          if (mode === undefined) {
            delete process.env.STRIPE_MODE;
          } else {
            process.env.STRIPE_MODE = mode;
          }

          try {
            assert.throws(() => inspect(response));
          } finally {
            process.env.STRIPE_MODE = 'test';
          }
        }
      );
    }

    await t.test('5 - Solicitud invalida', () => {
      for (const value of [
        null, undefined, '', 'invalid', 123,
      ]) {
        assert.throws(
          () => validate(value, country, fixture())
        );
      }
    });

    await t.test('6 - Pais esperado invalido', () => {
      for (const value of [
        null, undefined, '', 'mx', 'MEX', '12',
      ]) {
        assert.throws(
          () => validate(requestId, value, fixture())
        );
      }
    });

    await t.test('7 - Respuesta ausente', () => {
      assert.equal(inspect(null), null);
      assert.equal(inspect(undefined), null);
    });

    await t.test('8 - Respuestas incompatibles', () => {
      for (const value of [
        [], 'account', 123, true, {},
      ]) {
        assert.equal(inspect(value), null);
      }
    });

    await t.test('9 - Identificador ausente', () => {
      reject(r => delete r.id);
    });

    await t.test('10 - Identificador invalido', () => {
      for (const value of [
        '', 'acct_', 'cus_123',
        'acct_123-456', 123, null,
      ]) {
        reject(r => { r.id = value; });
      }
    });

    await t.test('11 - Identificador excesivo', () => {
      reject(r => {
        r.id = 'acct_' + 'A'.repeat(251);
      });
    });

    await t.test('12 - Objeto incorrecto', () => {
      reject(r => { r.object = 'customer'; });
      reject(r => delete r.object);
    });

    await t.test('13 - Pais diferente', () => {
      reject(r => { r.country = 'ES'; });
    });

    await t.test('14 - Pais ausente o invalido', () => {
      reject(r => delete r.country);
      reject(r => { r.country = 'mx'; });
      reject(r => { r.country = null; });
    });

    await t.test('15 - Cuenta eliminada', () => {
      reject(r => { r.deleted = true; });
    });

    await t.test('16 - Indicador de eliminacion invalido', () => {
      for (const value of ['false', 0, null]) {
        reject(r => { r.deleted = value; });
      }
    });

    await t.test('17 - Cuenta real bloqueada', () => {
      reject(r => { r.livemode = true; });
    });

    await t.test('18 - Indicador de modo invalido', () => {
      for (const value of ['false', 0, null]) {
        reject(r => { r.livemode = value; });
      }
    });

    await t.test('19 - Cobros habilitados', () => {
      reject(r => { r.charges_enabled = true; });
    });

    await t.test('20 - Retiros habilitados', () => {
      reject(r => { r.payouts_enabled = true; });
    });

    await t.test('21 - Registro previamente presentado', () => {
      reject(r => { r.details_submitted = true; });
    });

    await t.test('22 - Indicadores obligatorios', () => {
      for (const field of [
        'charges_enabled',
        'payouts_enabled',
        'details_submitted',
      ]) {
        reject(r => delete r[field]);
      }
    });

    await t.test('23 - Indicadores no booleanos', () => {
      for (const field of [
        'charges_enabled',
        'payouts_enabled',
        'details_submitted',
      ]) {
        for (const value of ['false', 0, null]) {
          reject(r => { r[field] = value; });
        }
      }
    });

    await t.test('24 - Metadatos ausentes', () => {
      reject(r => delete r.metadata);
      reject(r => { r.metadata = null; });
    });

    await t.test('25 - Metadatos incompletos', () => {
      for (const field of Object.keys(identity(requestId))) {
        reject(r => delete r.metadata[field]);
      }
    });

    await t.test('26 - Metadatos manipulados', () => {
      for (const field of Object.keys(identity(requestId))) {
        reject(r => {
          r.metadata[field] = 'alterado';
        });
      }
    });

    await t.test('27 - Identidad de otra solicitud', () => {
      reject(r => {
        r.metadata = identity(randomUUID());
      });
    });

    await t.test('28 - Propiedades heredadas', () => {
      const response = fixture();

      delete response.id;

      Object.setPrototypeOf(response, {
        id: accountId,
      });

      assert.equal(inspect(response), null);
    });

    await t.test('29 - Getters no ejecutados', () => {
      let accessed = false;
      const response = fixture();

      Object.defineProperty(response, 'id', {
        get() {
          accessed = true;
          throw new Error('Forbidden');
        },
      });

      assert.equal(inspect(response), null);
      assert.equal(accessed, false);
    });

    await t.test('30 - Proxy incompatible controlado', () => {
      const response = new Proxy(fixture(), {
        getOwnPropertyDescriptor() {
          throw new Error('Forbidden');
        },
      });

      assert.equal(inspect(response), null);
    });

    await t.test('31 - Respuesta correcta', () => {
      assert.deepEqual(inspect(fixture()), expected);
    });

    await t.test('32 - Indicadores opcionales ausentes', () => {
      const response = fixture();

      delete response.livemode;
      delete response.deleted;

      assert.deepEqual(inspect(response), expected);
    });

    await t.test('33 - Metadatos adicionales permitidos', () => {
      const response = fixture();
      response.metadata.additional = 'extra';

      assert.deepEqual(inspect(response), expected);
    });

    await t.test('34 - Datos sensibles excluidos', () => {
      const response = {
        ...fixture(),
        email: 'private@example.invalid',
        external_accounts: {
          data: ['SENSITIVE_BANK_DATA'],
        },
        individual: {
          name: 'SENSITIVE_NAME',
        },
        linkingAuthorized: true,
        retryAuthorized: true,
      };

      const result = inspect(response);

      assert.deepEqual(result, expected);
      assert.ok(!JSON.stringify(result).includes('SENSITIVE'));
      assert.ok(!('linkingAuthorized' in result));
      assert.ok(!('retryAuthorized' in result));
    });

    await t.test('35 - Respuesta original conservada', () => {
      const response = fixture();
      const before = JSON.stringify(response);

      const result = inspect(response);

      assert.deepEqual(result, expected);
      assert.equal(JSON.stringify(response), before);

      result.country = 'ES';

      assert.equal(response.country, country);
      assert.deepEqual(inspect(response), expected);
    });

  } finally {
    if (previousMode === undefined) {
      delete process.env.STRIPE_MODE;
    } else {
      process.env.STRIPE_MODE = previousMode;
    }
  }
});
