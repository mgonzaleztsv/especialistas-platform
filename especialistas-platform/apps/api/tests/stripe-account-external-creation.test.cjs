const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const {
  StripeAccountCreationService: Service,
} = require('../dist/payments/stripe-account-creation.service.js');

const {
  buildStripeAccountCreationIdentity: identity,
} = require('../dist/payments/stripe-account-creation-identity.js');

test('Stripe: creacion externa segura', async (t) => {
  const previousMode = process.env.STRIPE_MODE;

  try {
    process.env.STRIPE_MODE = 'test';

    function fixture() {
      const requestId = randomUUID();
      const specialistId = randomUUID();
      const processingToken = randomUUID();
      const accountId = 'acct_ExternalTest123';
      const metadata = identity(requestId);

      const state = {
        status: 'PENDING',
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
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: false,
          metadata,
        },

        createError: null,
        acquireError: false,
        clientFailureAt: 0,
        successError: false,
        uncertainError: false,
        failedError: false,
        invalidSuccess: false,
        disableAfterCreate: false,
        disableAfterAcquire: false,
        commitThenThrow: false,
      };

      const calls = [];
      let clientCalls = 0;

      function record(name, args) {
        calls.push({
          name,
          args: structuredClone(args),
        });
      }

      const requests = {
        async acquireProcessing(...args) {
          record('acquire', args);

          if (
            state.acquireError ||
            state.status !== 'PENDING'
          ) {
            throw new Error('Processing unavailable');
          }

          state.status = 'PROCESSING';

          if (state.disableAfterAcquire) {
            process.env.STRIPE_MODE = 'disabled';
          }

          return structuredClone(state.acquired);
        },

        async markFailed(...args) {
          record('failed', args);

          if (
            state.failedError ||
            state.status !== 'PROCESSING'
          ) {
            throw new Error('Persistence unavailable');
          }

          state.status = 'FAILED';

          return {
            transitioned: true,
            requestId,
            status: 'FAILED',
            lastErrorCode: args[2],
          };
        },

        async markUncertain(...args) {
          record('uncertain', args);

          if (
            state.uncertainError ||
            state.status !== 'PROCESSING'
          ) {
            throw new Error('Persistence unavailable');
          }

          state.status = 'UNCERTAIN';

          return {
            transitioned: true,
            requestId,
            status: 'UNCERTAIN',
            lastErrorCode: args[2],
          };
        },

        async markSucceeded(...args) {
          record('success', args);

          if (state.successError) {
            throw new Error('Persistence unavailable');
          }

          if (state.status !== 'PROCESSING') {
            throw new Error('Invalid state');
          }

          if (state.invalidSuccess) {
            return {
              transitioned: false,
              status: 'PROCESSING',
            };
          }

          state.status = 'SUCCEEDED';

          if (state.commitThenThrow) {
            throw new Error('Commit result unavailable');
          }

          return {
            transitioned: true,
            requestId,
            specialistId,
            stripeAccountId: accountId,
            status: 'SUCCEEDED',
          };
        },
      };

      const stripe = {
        getClient() {
          record('client', []);
          clientCalls++;

          if (state.clientFailureAt === clientCalls) {
            throw new Error('Client unavailable');
          }

          return {
            accounts: {
              async create(...args) {
                record('create', args);

                if (state.disableAfterCreate) {
                  process.env.STRIPE_MODE = 'disabled';
                }

                if (state.createError !== null) {
                  throw state.createError;
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
        requestId,
        specialistId,
        processingToken,
        accountId,

        run() {
          return service.processRegisteredRequest(
            specialistId
          );
        },

        count(name) {
          return calls.filter(c => c.name === name).length;
        },

        args(name) {
          return calls.find(c => c.name === name)?.args;
        },

        names() {
          return calls.map(c => c.name);
        },
      };
    }

    async function uncertain(f, code) {
      const result = await f.run();

      assert.equal(result.status, 'UNCERTAIN');
      assert.equal(result.retryAuthorized, false);
      assert.equal(f.state.status, 'UNCERTAIN');
      assert.equal(f.count('create'), 1);
      assert.equal(f.count('uncertain'), 1);
      assert.deepEqual(f.args('uncertain'), [
        f.requestId,
        f.processingToken,
        code,
      ]);
    }

    for (const [index, mode] of [
      undefined, 'disabled', 'live',
    ].entries()) {
      await t.test(
        `${index + 1} - Modo incompatible: ${mode}`,
        async () => {
          const f = fixture();

          if (mode === undefined) {
            delete process.env.STRIPE_MODE;
          } else {
            process.env.STRIPE_MODE = mode;
          }

          try {
            await assert.rejects(f.run());
            assert.equal(f.calls.length, 0);
          } finally {
            process.env.STRIPE_MODE = 'test';
          }
        }
      );
    }

    await t.test('4 - Cliente inicialmente no disponible', async () => {
      const f = fixture();
      f.state.clientFailureAt = 1;

      await assert.rejects(f.run());

      assert.equal(f.count('acquire'), 0);
      assert.equal(f.count('create'), 0);
      assert.equal(f.state.status, 'PENDING');
    });

    await t.test('5 - Adquisicion rechazada', async () => {
      const f = fixture();
      f.state.acquireError = true;

      await assert.rejects(f.run());
      assert.equal(f.count('create'), 0);
    });

    await t.test('6 - Solicitudes no pendientes bloqueadas', async () => {
      for (const status of [
        'PROCESSING', 'SUCCEEDED', 'FAILED', 'UNCERTAIN',
      ]) {
        const f = fixture();
        f.state.status = status;

        await assert.rejects(f.run());

        assert.equal(f.count('create'), 0);
        assert.equal(f.state.status, status);
      }
    });

    const invalidAcquisitions = [
      ['7 - Adquisicion incompatible',
        s => { s.acquired.acquired = false; }],

      ['8 - Especialista diferente',
        s => { s.acquired.specialistId = randomUUID(); }],

      ['9 - Intentos incompatibles',
        s => { s.acquired.attemptCount = 2; }],

      ['10 - Pais incompatible',
        s => { s.acquired.country = 'invalid'; }],

      ['11 - Idempotencia incompatible',
        s => { s.acquired.idempotencyKey = 'alterada'; }],

      ['12 - Cliente no disponible tras adquirir',
        s => { s.clientFailureAt = 2; }],
    ];

    for (const [name, change] of invalidAcquisitions) {
      await t.test(name, async () => {
        const f = fixture();
        change(f.state);

        const result = await f.run();

        assert.equal(result.status, 'FAILED');
        assert.equal(result.retryAuthorized, false);
        assert.equal(f.count('create'), 0);
        assert.equal(f.count('failed'), 1);
        assert.equal(f.state.status, 'FAILED');

        assert.deepEqual(f.args('failed'), [
          f.requestId,
          f.processingToken,
          'LOCAL_PRECONDITION_FAILED',
        ]);
      });
    }

    await t.test('13 - Tiempo externo agotado', async () => {
      const f = fixture();
      f.state.createError = { code: 'ETIMEDOUT' };

      await uncertain(f, 'EXTERNAL_TIMEOUT');
    });

    await t.test('14 - Conexion interrumpida', async () => {
      const f = fixture();
      f.state.createError = { code: 'ECONNRESET' };

      await uncertain(f, 'EXTERNAL_CONNECTION_ERROR');
    });

    await t.test('15 - Error externo desconocido', async () => {
      const f = fixture();
      f.state.createError = new Error('SENSITIVE_ERROR');

      await uncertain(f, 'EXTERNAL_RESULT_UNKNOWN');

      assert.ok(
        !JSON.stringify(f.calls).includes('SENSITIVE_ERROR')
      );
    });

    await t.test('16 - Error de autenticacion conservador', async () => {
      const f = fixture();

      f.state.createError = {
        type: 'StripeAuthenticationError',
      };

      await uncertain(f, 'EXTERNAL_RESULT_UNKNOWN');
    });

    const invalidResponses = [
      ['17 - Respuesta ausente',
        s => { s.response = null; }],

      ['18 - Cuenta incompatible',
        s => { s.response.id = 'cus_Invalid'; }],

      ['19 - Pais externo diferente',
        s => { s.response.country = 'ES'; }],

      ['20 - Metadatos incompatibles',
        s => { s.response.metadata = {}; }],

      ['21 - Cuenta real rechazada',
        s => { s.response.livemode = true; }],

      ['22 - Cuenta financieramente habilitada',
        s => { s.response.payouts_enabled = true; }],
    ];

    for (const [name, change] of invalidResponses) {
      await t.test(name, async () => {
        const f = fixture();
        change(f.state);

        await uncertain(f, 'EXTERNAL_RESPONSE_INVALID');

        assert.equal(f.count('success'), 0);
      });
    }

    await t.test('23 - Fallo de persistencia tras creacion', async () => {
      const f = fixture();
      f.state.successError = true;

      await uncertain(f, 'LOCAL_PERSISTENCE_ERROR');

      assert.equal(f.count('success'), 1);
    });

    await t.test('24 - Resultado persistente incompatible', async () => {
      const f = fixture();
      f.state.invalidSuccess = true;

      await uncertain(f, 'LOCAL_PERSISTENCE_ERROR');
    });

    await t.test('25 - Imposibilidad de registrar incertidumbre', async () => {
      const f = fixture();

      f.state.createError = new Error('External error');
      f.state.uncertainError = true;

      await assert.rejects(
        f.run(),
        error => error.getStatus() === 503
      );

      assert.equal(f.count('create'), 1);
      assert.equal(f.state.status, 'PROCESSING');

      await assert.rejects(f.run());
      assert.equal(f.count('create'), 1);
    });

    await t.test('26 - Fallo al registrar rechazo local', async () => {
      const f = fixture();

      f.state.clientFailureAt = 2;
      f.state.failedError = true;

      await assert.rejects(f.run());

      assert.equal(f.count('create'), 0);
      assert.equal(f.state.status, 'PROCESSING');
    });

    await t.test('27 - Desactivacion durante procesamiento', async () => {
      for (const stage of [
        'disableAfterAcquire',
        'disableAfterCreate',
      ]) {
        const f = fixture();
        f.state[stage] = true;

        try {
          await assert.rejects(f.run());

          assert.equal(
            f.count('create'),
            stage === 'disableAfterAcquire' ? 0 : 1
          );

          assert.equal(f.count('success'), 0);
          assert.equal(f.state.status, 'PROCESSING');

        } finally {
          process.env.STRIPE_MODE = 'test';
        }
      }
    });

    await t.test('28 - Creacion satisfactoria y argumentos exactos', async () => {
      const f = fixture();
      const result = await f.run();

      assert.deepEqual(result, {
        status: 'SUCCEEDED',
        requestId: f.requestId,
        stripeAccountId: f.accountId,
        retryAuthorized: false,
      });

      assert.deepEqual(f.names(), [
        'client', 'acquire', 'client',
        'create', 'success',
      ]);

      const [params, options] = f.args('create');

      assert.equal(params.country, 'MX');
      assert.deepEqual(
        params.metadata,
        identity(f.requestId)
      );

      assert.equal(
        options.idempotencyKey,
        f.state.acquired.idempotencyKey
      );

      assert.equal(options.maxNetworkRetries, 0);
      assert.equal(options.timeout, 20000);

      assert.deepEqual(f.args('success'), [
        f.requestId,
        f.processingToken,
        {
          stripeAccountId: f.accountId,
          country: 'MX',
          livemode: false,
        },
      ]);

      assert.equal(f.state.status, 'SUCCEEDED');
    });

    await t.test('29 - Veinte solicitudes simultaneas', async () => {
      const f = fixture();

      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () => f.run())
      );

      assert.equal(
        results.filter(r => r.status === 'fulfilled').length,
        1
      );

      assert.equal(
        results.filter(r => r.status === 'rejected').length,
        19
      );

      assert.equal(f.count('create'), 1);
      assert.equal(f.count('success'), 1);
      assert.equal(f.state.status, 'SUCCEEDED');
    });

    await t.test('30 - Confirmacion de commit perdida', async () => {
      const f = fixture();
      f.state.commitThenThrow = true;

      await assert.rejects(
        f.run(),
        error => error.getStatus() === 503
      );

      assert.equal(f.state.status, 'SUCCEEDED');
      assert.equal(f.count('create'), 1);

      await assert.rejects(f.run());

      assert.equal(f.count('create'), 1);
      assert.equal(f.state.status, 'SUCCEEDED');
    });

  } finally {
    if (previousMode === undefined) {
      delete process.env.STRIPE_MODE;
    } else {
      process.env.STRIPE_MODE = previousMode;
    }
  }
});
