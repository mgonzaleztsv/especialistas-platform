const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const {
  StripeAccountCreationService: Service,
} = require('../dist/payments/stripe-account-creation.service.js');

const {
  buildStripeAccountCreationIdentity: identity,
} = require('../dist/payments/stripe-account-creation-identity.js');

test('Stripe: protecciones adicionales de creacion', async (t) => {
  const previousMode = process.env.STRIPE_MODE;

  try {
    process.env.STRIPE_MODE = 'test';

    function fixture() {
      const requestId = randomUUID();
      const specialistId = randomUUID();
      const processingToken = randomUUID();
      const accountId = 'acct_Protected123';
      const metadata = identity(requestId);

      const state = {
        acquired: {
          acquired: true,
          requestId,
          specialistId,
          country: 'MX',
          idempotencyKey: metadata.connectpro_reference,
          processingToken,
          processingAt: new Date(),
          attemptCount: 1,
        },

        response: {
          id: accountId,
          object: 'account',
          country: 'MX',
          metadata,
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: false,
        },

        status: 'PENDING',
        externalError: null,
        clientError: false,
        acquireError: false,
        failedError: false,
        uncertainError: false,
        failedOverride: {},
        uncertainOverride: {},
        successOverride: {},
        disableAfter: null,
      };

      const calls = [];

      function disable(stage) {
        if (state.disableAfter === stage) {
          process.env.STRIPE_MODE = 'disabled';
        }
      }

      const requests = {
        async acquireProcessing() {
          calls.push('acquire');

          if (state.acquireError) {
            throw new Error('SENSITIVE_DATABASE_ERROR');
          }

          if (state.status !== 'PENDING') {
            throw new Error('Processing unavailable');
          }

          state.status = 'PROCESSING';
          return structuredClone(state.acquired);
        },

        async markFailed(id, token, errorCode) {
          calls.push('failed');

          if (state.failedError) {
            throw new Error('SENSITIVE_FAILED_ERROR');
          }

          state.status = 'FAILED';

          disable('failed');

          return {
            transitioned: true,
            requestId: id,
            status: 'FAILED',
            lastErrorCode: errorCode,
            ...state.failedOverride,
          };
        },

        async markUncertain(id, token, errorCode) {
          calls.push('uncertain');

          if (state.uncertainError) {
            throw new Error('SENSITIVE_UNCERTAIN_ERROR');
          }

          state.status = 'UNCERTAIN';

          disable('uncertain');

          return {
            transitioned: true,
            requestId: id,
            status: 'UNCERTAIN',
            lastErrorCode: errorCode,
            ...state.uncertainOverride,
          };
        },

        async markSucceeded() {
          calls.push('success');
          state.status = 'SUCCEEDED';

          disable('success');

          return {
            transitioned: true,
            requestId,
            specialistId,
            stripeAccountId: accountId,
            status: 'SUCCEEDED',
            ...state.successOverride,
          };
        },
      };

      const stripe = {
        getClient() {
          calls.push('client');

          if (state.clientError) {
            throw new Error('SENSITIVE_CLIENT_ERROR');
          }

          return {
            accounts: {
              async create() {
                calls.push('create');

                if (state.externalError) {
                  throw state.externalError;
                }

                return structuredClone(state.response);
              },
            },
          };
        },
      };

      const service = new Service(requests, stripe);

      return {
        state,
        calls,

        run() {
          return service.processRegisteredRequest(
            specialistId
          );
        },

        count(name) {
          return calls.filter(c => c === name).length;
        },
      };
    }

    async function safeRejection(f) {
      await assert.rejects(f.run(), error => {
        assert.equal(error.getStatus(), 503);
        assert.ok(!String(error.message).includes('SENSITIVE'));
        assert.ok(
          !JSON.stringify(error.getResponse())
            .includes('SENSITIVE')
        );

        return true;
      });
    }

    const tokens = [
      ['1 - Token ausente', undefined],
      ['2 - Token nulo', null],
      ['3 - Token vacio', ''],
      ['4 - Token incompatible', 'invalid'],
      ['5 - Token numerico', 123],
      ['6 - Token UUID de version incorrecta',
        '12345678-1234-1234-8234-123456789012'],
    ];

    for (const [name, token] of tokens) {
      await t.test(name, async () => {
        const f = fixture();

        f.state.acquired.processingToken = token;

        await safeRejection(f);

        assert.equal(f.count('create'), 0);
        assert.equal(f.count('failed'), 0);
        assert.equal(f.count('uncertain'), 0);
        assert.equal(f.count('success'), 0);
      });
    }

    const dates = [
      ['7 - Fecha ausente', () => undefined],
      ['8 - Fecha nula', () => null],
      ['9 - Fecha invalida', () => new Date(NaN)],
      ['10 - Fecha de texto', () => new Date().toISOString()],
      ['11 - Fecha futura', () => new Date(Date.now() + 60000)],
      ['12 - Fecha vencida', () => new Date(Date.now() - 120000)],
      ['13 - Fecha anterior al origen', () => new Date(-1)],
    ];

    for (const [name, date] of dates) {
      await t.test(name, async () => {
        const f = fixture();

        f.state.acquired.processingAt = date();

        const result = await f.run();

        assert.equal(result.status, 'FAILED');
        assert.equal(result.retryAuthorized, false);
        assert.equal(f.count('create'), 0);
        assert.equal(f.count('failed'), 1);
      });
    }

    const failedCases = [
      ['14 - Rechazo local no confirmado',
        { transitioned: false }],
      ['15 - Estado de rechazo incompatible',
        { status: 'PROCESSING' }],
      ['16 - Identidad de rechazo incompatible',
        { requestId: 'other' }],
      ['17 - Codigo de rechazo incompatible',
        { lastErrorCode: 'other' }],
    ];

    for (const [name, override] of failedCases) {
      await t.test(name, async () => {
        const f = fixture();

        f.state.acquired.country = 'invalid';
        f.state.failedOverride = override;

        await safeRejection(f);

        assert.equal(f.count('create'), 0);
        assert.equal(f.count('failed'), 1);
      });
    }

    const uncertainCases = [
      ['18 - Incertidumbre no confirmada',
        { transitioned: false }],
      ['19 - Estado incierto incompatible',
        { status: 'PROCESSING' }],
      ['20 - Identidad incierta incompatible',
        { requestId: 'other' }],
      ['21 - Codigo incierto incompatible',
        { lastErrorCode: 'other' }],
    ];

    for (const [name, override] of uncertainCases) {
      await t.test(name, async () => {
        const f = fixture();

        f.state.externalError = {
          code: 'ETIMEDOUT',
        };

        f.state.uncertainOverride = override;

        await safeRejection(f);

        assert.equal(f.count('create'), 1);
        assert.equal(f.count('uncertain'), 1);
        assert.equal(f.count('success'), 0);

        await assert.rejects(f.run());
        assert.equal(f.count('create'), 1);
      });
    }

    await t.test('22 - Error de cliente sanitizado', async () => {
      const f = fixture();
      f.state.clientError = true;

      await safeRejection(f);

      assert.equal(f.count('acquire'), 0);
      assert.equal(f.count('create'), 0);
    });

    await t.test('23 - Error de adquisicion sanitizado', async () => {
      const f = fixture();
      f.state.acquireError = true;

      await safeRejection(f);
      assert.equal(f.count('create'), 0);
    });

    await t.test('24 - Errores de persistencia sanitizados', async () => {
      const failed = fixture();

      failed.state.acquired.country = 'invalid';
      failed.state.failedError = true;

      await safeRejection(failed);
      assert.equal(failed.count('create'), 0);

      const uncertain = fixture();

      uncertain.state.externalError = {
        code: 'ETIMEDOUT',
      };

      uncertain.state.uncertainError = true;

      await safeRejection(uncertain);
      assert.equal(uncertain.count('create'), 1);
    });

    await t.test('25 - Desactivacion durante finalizacion', async () => {
      for (const stage of [
        'failed', 'uncertain', 'success',
      ]) {
        const f = fixture();

        f.state.disableAfter = stage;

        if (stage === 'failed') {
          f.state.acquired.country = 'invalid';
        }

        if (stage === 'uncertain') {
          f.state.externalError = {
            code: 'ETIMEDOUT',
          };
        }

        try {
          await safeRejection(f);

          assert.equal(
            f.count('create'),
            stage === 'failed' ? 0 : 1
          );
        } finally {
          process.env.STRIPE_MODE = 'test';
        }

        const previous = f.count('create');

        await assert.rejects(f.run());

        assert.equal(f.count('create'), previous);
      }
    });

  } finally {
    if (previousMode === undefined) {
      delete process.env.STRIPE_MODE;
    } else {
      process.env.STRIPE_MODE = previousMode;
    }
  }
});
