const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('Stripe: integracion de creacion externa con PostgreSQL', async (t) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.STRIPE_MODE, 'disabled');

  assert.equal(
    process.env.INTERNAL_MVP_PAYMENTS_ENABLED,
    'false'
  );

  assert.equal(
    process.env.WORK_ORDER_EXPIRATION_ENABLED,
    'false'
  );

  for (const key of Object.keys(process.env)) {
    if (key.toUpperCase().includes('STRIPE')) {
      assert.equal(key, 'STRIPE_MODE');
    }
  }

  const db = new URL(process.env.DATABASE_URL);

  assert.ok(['postgres:', 'postgresql:'].includes(db.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(db.hostname));
  assert.equal(db.port, '5433');
  assert.equal(db.pathname, '/connectpro_test');
  assert.equal(db.username, 'connectpro_test');
  assert.equal(db.search, '?schema=public');
  assert.equal(db.hash, '');

  const { PrismaClient } = require('@prisma/client');
  const { PrismaPg } = require('@prisma/adapter-pg');

  const {
    StripeAccountCreationService,
  } = require('../dist/payments/stripe-account-creation.service.js');

  const {
    StripeAccountCreationRequestService,
  } = require('../dist/payments/stripe-account-creation-request.service.js');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL,
    }),
  });

  const fixtures = Array.from(
    { length: 9 },
    () => ({
      userId: randomUUID(),
      specialistId: randomUUID(),
      accountId: 'acct_Fictitious' +
        randomUUID().replace(/-/g, ''),
    })
  );

  const [a, b, c, d, e, f, g, h, i] = fixtures;

  const specialistIds = fixtures.map(x => x.specialistId);
  const userIds = fixtures.map(x => x.userId);

  const requests =
    new StripeAccountCreationRequestService(prisma);

  const originalMode = process.env.STRIPE_MODE;

  let initialized = false;
  let before;

  async function inventory() {
    const rows = await prisma.$queryRaw`
      SELECT
        (SELECT COUNT(*)::int FROM public."User")
          AS users,
        (SELECT COUNT(*)::int FROM public."Specialist")
          AS specialists,
        (SELECT COUNT(*)::int FROM public."StripeConnectedAccount")
          AS accounts,
        (SELECT COUNT(*)::int FROM public."StripeAccountCreationRequest")
          AS requests,
        (SELECT COUNT(*)::int FROM public."Payment")
          AS payments,
        (SELECT COUNT(*)::int FROM public."PaymentMovement")
          AS movements
    `;

    return rows[0];
  }

  function current(fixture) {
    return prisma.stripeAccountCreationRequest.findUnique({
      where: { specialistId: fixture.specialistId },
    });
  }

  function linked(fixture) {
    return prisma.stripeConnectedAccount.findUnique({
      where: { specialistId: fixture.specialistId },
    });
  }

  async function register(fixture) {
    const result = await requests.registerRequest(
      fixture.specialistId,
      'US'
    );

    assert.equal(result.created, true);
    assert.equal(result.request.status, 'PENDING');

    return result.request;
  }

  function simulated(fixture, options = {}) {
    let calls = 0;

    const stripe = {
      getClient() {
        assert.equal(process.env.STRIPE_MODE, 'test');

        return {
          accounts: {
            async create(params, requestOptions) {
              calls++;

              assert.equal(params.country, 'US');
              assert.equal(requestOptions.maxNetworkRetries, 0);
              assert.equal(
                requestOptions.idempotencyKey,
                params.metadata.connectpro_reference
              );

              if (options.error) {
                throw options.error;
              }

              return {
                id: fixture.accountId,
                object: 'account',
                country: 'US',
                metadata: params.metadata,
                charges_enabled: false,
                payouts_enabled: false,
                details_submitted: false,
                ...options.response,
              };
            },
          },
        };
      },
    };

    const local = {
      acquireProcessing:
        requests.acquireProcessing.bind(requests),

      markFailed:
        requests.markFailed.bind(requests),

      markUncertain:
        requests.markUncertain.bind(requests),

      async markSucceeded(...args) {
        const result = await requests.markSucceeded(...args);

        if (options.loseCommitConfirmation) {
          throw new Error('Simulated lost confirmation');
        }

        return result;
      },
    };

    const service =
      new StripeAccountCreationService(local, stripe);

    return {
      run() {
        return service.processRegisteredRequest(
          fixture.specialistId
        );
      },

      count() {
        return calls;
      },
    };
  }

  async function verifyUncertain(fixture, errorCode) {
    const row = await current(fixture);

    assert.equal(row.status, 'UNCERTAIN');
    assert.equal(row.attemptCount, 1);
    assert.equal(row.lastErrorCode, errorCode);
    assert.equal(row.processingToken, null);
    assert.equal(row.processingAt, null);
    assert.equal(row.stripeAccountId, null);
    assert.equal(row.completedAt, null);
    assert.equal(await linked(fixture), null);
  }

  try {
    const identity = await prisma.$queryRaw`
      SELECT current_database() AS db,
             current_user AS usr,
             current_schema() AS schema
    `;

    assert.deepEqual(identity[0], {
      db: 'connectpro_test',
      usr: 'connectpro_test',
      schema: 'public',
    });

    before = await inventory();

    await prisma.$transaction(async tx => {
      for (const fixture of fixtures) {
        await tx.user.create({
          data: {
            id: fixture.userId,
            name: 'Temporary Stripe external creation test',
            email: fixture.userId + '@example.invalid',
            passwordHash: 'INVALID_TEST_HASH',
            role: 'SPECIALIST',
          },
        });

        await tx.specialist.create({
          data: {
            id: fixture.specialistId,
            userId: fixture.userId,
          },
        });
      }
    });

    initialized = true;
    process.env.STRIPE_MODE = 'test';

    await t.test('1 - Creacion y vinculacion persistente', async () => {
      const request = await register(a);
      const mock = simulated(a);

      const result = await mock.run();

      assert.equal(result.status, 'SUCCEEDED');
      assert.equal(result.requestId, request.id);
      assert.equal(result.stripeAccountId, a.accountId);
      assert.equal(result.retryAuthorized, false);
      assert.equal(mock.count(), 1);

      const saved = await current(a);
      const account = await linked(a);

      assert.equal(saved.status, 'SUCCEEDED');
      assert.equal(saved.attemptCount, 1);
      assert.equal(saved.stripeAccountId, a.accountId);
      assert.equal(saved.processingToken, null);
      assert.equal(saved.processingAt, null);
      assert.ok(saved.completedAt instanceof Date);

      assert.equal(account.stripeAccountId, a.accountId);
      assert.equal(account.country, 'US');
      assert.equal(account.livemode, false);
      assert.equal(account.chargesEnabled, false);
      assert.equal(account.payoutsEnabled, false);
      assert.equal(account.detailsSubmitted, false);
      assert.equal(account.transfersCapability, null);
    });

    await t.test('2 - Veinte procesamientos concurrentes', async () => {
      await register(b);

      const mock = simulated(b);

      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () => mock.run())
      );

      assert.equal(
        results.filter(r => r.status === 'fulfilled').length,
        1
      );

      assert.equal(
        results.filter(r => r.status === 'rejected').length,
        19
      );

      assert.equal(mock.count(), 1);
      assert.equal((await current(b)).status, 'SUCCEEDED');
      assert.equal((await current(b)).attemptCount, 1);
      assert.equal((await linked(b)).stripeAccountId, b.accountId);
    });

    await t.test('3 - Tiempo agotado e incertidumbre persistente', async () => {
      await register(c);

      const mock = simulated(c, {
        error: { code: 'ETIMEDOUT' },
      });

      const result = await mock.run();

      assert.equal(result.status, 'UNCERTAIN');
      assert.equal(result.retryAuthorized, false);

      await verifyUncertain(c, 'EXTERNAL_TIMEOUT');

      await assert.rejects(mock.run());
      assert.equal(mock.count(), 1);
    });

    await t.test('4 - Respuesta externa incompatible', async () => {
      await register(d);

      const mock = simulated(d, {
        response: { metadata: {} },
      });

      assert.equal((await mock.run()).status, 'UNCERTAIN');

      await verifyUncertain(d, 'EXTERNAL_RESPONSE_INVALID');

      await assert.rejects(mock.run());
      assert.equal(mock.count(), 1);
    });

    await t.test('5 - Conflicto de cuenta y rollback', async () => {
      await register(e);

      const original = await linked(a);

      assert.ok(original);

      const mock = simulated(e, {
        response: { id: a.accountId },
      });

      const result = await mock.run();

      assert.equal(result.status, 'UNCERTAIN');

      await verifyUncertain(e, 'LOCAL_PERSISTENCE_ERROR');

      assert.deepEqual(await linked(a), original);
      assert.equal((await current(a)).status, 'SUCCEEDED');

      await assert.rejects(mock.run());
      assert.equal(mock.count(), 1);
    });

    await t.test('6 - Confirmacion de commit perdida', async () => {
      await register(f);

      const mock = simulated(f, {
        loseCommitConfirmation: true,
      });

      await assert.rejects(mock.run());

      assert.equal((await current(f)).status, 'SUCCEEDED');
      assert.equal((await linked(f)).stripeAccountId, f.accountId);

      await assert.rejects(mock.run());

      assert.equal(mock.count(), 1);
    });

    await t.test('7 - Cuenta local previa al procesamiento', async () => {
      const request = await register(g);

      await prisma.stripeConnectedAccount.create({
        data: {
          specialistId: g.specialistId,
          country: 'US',
          stripeAccountId: g.accountId,
        },
      });

      const mock = simulated(g);

      await assert.rejects(mock.run());

      assert.equal(mock.count(), 0);
      assert.deepEqual(await current(g), request);
      assert.equal((await linked(g)).stripeAccountId, g.accountId);
    });

    await t.test('8 - Solicitud inexistente bloqueada', async () => {
      const mock = simulated(h);

      await assert.rejects(mock.run());

      assert.equal(mock.count(), 0);
      assert.equal(await current(h), null);
      assert.equal(await linked(h), null);
    });

    await t.test('9 - Modo desactivado impide procesamiento', async () => {
      const request = await register(i);
      const mock = simulated(i);

      process.env.STRIPE_MODE = 'disabled';

      try {
        await assert.rejects(mock.run());
      } finally {
        process.env.STRIPE_MODE = 'test';
      }

      assert.equal(mock.count(), 0);
      assert.deepEqual(await current(i), request);
      assert.equal(await linked(i), null);
    });

  } finally {
    process.env.STRIPE_MODE = originalMode;

    try {
      if (initialized) {
        await prisma.$transaction(async tx => {
          await tx.stripeAccountCreationRequest.deleteMany({
            where: {
              specialistId: { in: specialistIds },
            },
          });

          await tx.stripeConnectedAccount.deleteMany({
            where: {
              specialistId: { in: specialistIds },
            },
          });

          await tx.specialist.deleteMany({
            where: {
              id: { in: specialistIds },
              userId: { in: userIds },
            },
          });

          await tx.user.deleteMany({
            where: { id: { in: userIds } },
          });
        });

        await t.test('10 - Limpieza e inventario conservado', async () => {
          assert.equal(
            await prisma.user.count({
              where: { id: { in: userIds } },
            }),
            0
          );

          assert.equal(
            await prisma.specialist.count({
              where: { id: { in: specialistIds } },
            }),
            0
          );

          assert.equal(
            await prisma.stripeAccountCreationRequest.count({
              where: {
                specialistId: { in: specialistIds },
              },
            }),
            0
          );

          assert.equal(
            await prisma.stripeConnectedAccount.count({
              where: {
                specialistId: { in: specialistIds },
              },
            }),
            0
          );

          assert.deepEqual(await inventory(), before);
        });
      }
    } finally {
      await prisma.$disconnect();
    }
  }
});
