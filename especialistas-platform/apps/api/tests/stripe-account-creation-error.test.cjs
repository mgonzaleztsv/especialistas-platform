const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyStripeAccountCreationError: classify,
} = require('../dist/payments/stripe-account-creation-error.js');

test('Stripe: clasificacion segura de errores', async (t) => {
  const previousMode = process.env.STRIPE_MODE;

  const UNKNOWN = 'EXTERNAL_RESULT_UNKNOWN';
  const TIMEOUT = 'EXTERNAL_TIMEOUT';
  const CONNECTION = 'EXTERNAL_CONNECTION_ERROR';

  function verify(error, expected) {
    const result = classify(error);

    assert.deepEqual(result, {
      status: 'UNCERTAIN',
      errorCode: expected,
      retryAuthorized: false,
      linkingAuthorized: false,
    });

    return result;
  }

  try {
    process.env.STRIPE_MODE = 'test';

    const modes = [
      undefined,
      'disabled',
      'live',
      'unknown',
    ];

    for (const [index, mode] of modes.entries()) {
      await t.test(
        `${index + 1} - Modo incompatible: ${mode}`,
        () => {
          if (mode === undefined) {
            delete process.env.STRIPE_MODE;
          } else {
            process.env.STRIPE_MODE = mode;
          }

          try {
            assert.throws(() => classify({}));
          } finally {
            process.env.STRIPE_MODE = 'test';
          }
        }
      );
    }

    const cases = [
      ['5 - Error nulo', null, UNKNOWN],

      ['6 - Error indefinido', undefined, UNKNOWN],

      ['7 - Error de texto',
        'ETIMEDOUT', UNKNOWN],

      ['8 - Error numerico',
        500, UNKNOWN],

      ['9 - Error generico',
        new Error('External failure'), UNKNOWN],

      ['10 - Tiempo agotado',
        { code: 'ETIMEDOUT' }, TIMEOUT],

      ['11 - Tiempo socket agotado',
        { code: 'ESOCKETTIMEDOUT' }, TIMEOUT],

      ['12 - Conexion abortada',
        { code: 'ECONNABORTED' }, TIMEOUT],

      ['13 - Conexion reiniciada',
        { code: 'ECONNRESET' }, CONNECTION],

      ['14 - Conexion rechazada',
        { code: 'ECONNREFUSED' }, CONNECTION],

      ['15 - Canal interrumpido',
        { code: 'EPIPE' }, CONNECTION],

      ['16 - DNS no localizado',
        { code: 'ENOTFOUND' }, CONNECTION],

      ['17 - DNS temporal',
        { code: 'EAI_AGAIN' }, CONNECTION],

      ['18 - Red inaccesible',
        { code: 'ENETUNREACH' }, CONNECTION],

      ['19 - Servidor inaccesible',
        { code: 'EHOSTUNREACH' }, CONNECTION],

      ['20 - Error de conexion Stripe',
        { type: 'StripeConnectionError' },
        CONNECTION],

      ['21 - Error de autenticacion',
        { type: 'StripeAuthenticationError' },
        UNKNOWN],

      ['22 - Error de idempotencia',
        { type: 'StripeIdempotencyError' },
        UNKNOWN],

      ['23 - Error de solicitud',
        { type: 'StripeInvalidRequestError' },
        UNKNOWN],

      ['24 - Error interno de Stripe',
        { type: 'StripeAPIError',
          statusCode: 500 },
        UNKNOWN],

      ['25 - Limite de solicitudes',
        { type: 'StripeRateLimitError',
          statusCode: 429 },
        UNKNOWN],
    ];

    for (const [name, error, expected] of cases) {
      await t.test(name, () => {
        verify(error, expected);
      });
    }

    await t.test('26 - Prioridad de tiempo agotado', () => {
      verify({
        type: 'StripeConnectionError',
        code: 'ETIMEDOUT',
      }, TIMEOUT);
    });

    await t.test('27 - Propiedades heredadas rechazadas', () => {
      const error = Object.create({
        type: 'StripeConnectionError',
        code: 'ETIMEDOUT',
      });

      verify(error, UNKNOWN);
    });

    await t.test('28 - Getters no ejecutados', () => {
      let accessed = false;

      const error = {
        get type() {
          accessed = true;
          throw new Error('Forbidden');
        },
        get code() {
          accessed = true;
          throw new Error('Forbidden');
        },
      };

      verify(error, UNKNOWN);
      assert.equal(accessed, false);
    });

    await t.test('29 - Proxy incompatible controlado', () => {
      const error = new Proxy({}, {
        getOwnPropertyDescriptor() {
          throw new Error('Forbidden');
        },
      });

      verify(error, UNKNOWN);
    });

    await t.test('30 - Datos sensibles excluidos', () => {
      const error = {
        type: 'StripeAPIError',
        code: 'unknown',
        message: 'SENSITIVE_MESSAGE',
        stack: 'SENSITIVE_STACK',
        requestId: 'req_Sensitive123',
        raw: {
          apiKey: 'SENSITIVE_KEY',
          email: 'private@example.invalid',
        },
        retryAuthorized: true,
        linkingAuthorized: true,
        status: 'SUCCEEDED',
      };

      const before = JSON.stringify(error);
      const result = verify(error, UNKNOWN);
      const output = JSON.stringify(result);

      assert.ok(!output.includes('SENSITIVE'));
      assert.ok(!output.includes('req_'));
      assert.ok(!output.includes('@'));
      assert.equal(JSON.stringify(error), before);
    });

  } finally {
    if (previousMode === undefined) {
      delete process.env.STRIPE_MODE;
    } else {
      process.env.STRIPE_MODE = previousMode;
    }
  }
});
