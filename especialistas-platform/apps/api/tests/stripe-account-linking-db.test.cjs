const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('Stripe: vinculacion atomica con PostgreSQL', async (t) => {
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
        StripeAccountCreationRequestService
    } = require('../dist/payments/stripe-account-creation-request.service.js');

    const {
        StripeConnectedAccountService
    } = require('../dist/payments/stripe-connected-account.service.js');

    function newClient() {
        return new PrismaClient({
            adapter: new PrismaPg({
                connectionString: process.env.DATABASE_URL
            })
        });
    }

    const prisma = newClient();
    const anotherPrisma = newClient();

    const service =
        new StripeAccountCreationRequestService(prisma);

    const anotherService =
        new StripeAccountCreationRequestService(anotherPrisma);

    const readiness =
        new StripeConnectedAccountService(prisma);

    const originalMode = process.env.STRIPE_MODE;

    const fixtures = Array.from(
        { length: 8 },
        () => ({
            userId: randomUUID(),
            specialistId: randomUUID(),
            stripeAccountId:
                'acct_Fictitious' +
                randomUUID().replace(/-/g, '')
        })
    );

    const [a, b, c, d, e, f, g, h] = fixtures;

    const specialistIds = fixtures.map(
        item => item.specialistId
    );

    const userIds = fixtures.map(
        item => item.userId
    );

    let initialized = false;
    let before;

    const acquired = new Map();

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
            where: {
                specialistId: fixture.specialistId
            }
        });
    }

    function linked(fixture) {
        return prisma.stripeConnectedAccount.findUnique({
            where: {
                specialistId: fixture.specialistId
            }
        });
    }

    function succeed(
        fixture,
        instance = service,
        overrides = {}
    ) {
        const operation = acquired.get(
            fixture.specialistId
        );

        return instance.markSucceeded(
            operation.requestId,
            operation.processingToken,
            {
                stripeAccountId:
                    fixture.stripeAccountId,
                country: 'US',
                livemode: false,
                ...overrides
            }
        );
    }

    async function expectStatus(operation, status) {
        await assert.rejects(operation, error => {
            assert.equal(error.getStatus(), status);
            return true;
        });
    }

    function verifyHistory(previous, updated) {
        for (const field of [
            'id',
            'specialistId',
            'country',
            'livemode',
            'idempotencyKey',
            'attemptCount',
            'firstAttemptAt',
            'lastAttemptAt',
            'createdAt'
        ]) {
            assert.deepEqual(
                updated[field],
                previous[field]
            );
        }

        assert.equal(updated.processingToken, null);
        assert.equal(updated.processingAt, null);
        assert.equal(updated.lastErrorCode, null);
    }

    try {
        for (const connection of [prisma, anotherPrisma]) {
            const identity = await connection.$queryRaw`
                SELECT current_database() AS db,
                       current_user AS usr,
                       current_schema() AS schema
            `;

            assert.deepEqual(identity[0], {
                db: 'connectpro_test',
                usr: 'connectpro_test',
                schema: 'public'
            });
        }

        before = await inventory();

        await prisma.$transaction(async tx => {
            for (const fixture of fixtures) {
                await tx.user.create({
                    data: {
                        id: fixture.userId,
                        name: 'Temporary Stripe linking test',
                        email:
                            fixture.userId + '@example.invalid',
                        passwordHash: 'INVALID_TEST_HASH',
                        role: 'SPECIALIST'
                    }
                });

                await tx.specialist.create({
                    data: {
                        id: fixture.specialistId,
                        userId: fixture.userId
                    }
                });
            }

            await tx.stripeConnectedAccount.create({
                data: {
                    specialistId: h.specialistId,
                    stripeAccountId: h.stripeAccountId,
                    country: 'US'
                }
            });
        });

        initialized = true;

        process.env.STRIPE_MODE = 'test';

        for (const fixture of [a, b, c, d, e, f, g]) {
            await service.registerRequest(
                fixture.specialistId,
                'US'
            );

            acquired.set(
                fixture.specialistId,
                await service.acquireProcessing(
                    fixture.specialistId
                )
            );
        }

        await t.test('1 - Vinculacion exitosa persistente', async () => {
            const previous = await current(a);

            const result = await succeed(a);

            const request = await current(a);
            const account = await linked(a);

            assert.equal(result.transitioned, true);
            assert.equal(request.status, 'SUCCEEDED');
            assert.equal(
                request.stripeAccountId,
                a.stripeAccountId
            );

            assert.ok(account);

            assert.equal(
                account.stripeAccountId,
                request.stripeAccountId
            );

            assert.equal(
                account.specialistId,
                a.specialistId
            );

            assert.deepEqual(
                request.completedAt,
                result.completedAt
            );

            verifyHistory(previous, request);
        });

        await t.test('2 - Cuenta sin habilitacion financiera', async () => {
            const account = await linked(a);

            assert.equal(account.detailsSubmitted, false);
            assert.equal(account.chargesEnabled, false);
            assert.equal(account.payoutsEnabled, false);
            assert.equal(account.transfersCapability, null);
            assert.equal(account.lastSyncedAt, null);
            assert.equal(account.livemode, false);
        });

        await t.test('3 - Especialista aun no elegible', async () => {
            const result =
                await readiness.getTransferReadiness(
                    a.specialistId
                );

            assert.equal(result.eligible, false);

            for (const reason of [
                'DETAILS_NOT_SUBMITTED',
                'TRANSFERS_NOT_ACTIVE',
                'PAYOUTS_NOT_ENABLED',
                'ACCOUNT_SYNC_REQUIRED'
            ]) {
                assert.ok(
                    result.reasons.includes(reason)
                );
            }
        });

        await t.test('4 - Token utilizado no puede repetirse', async () => {
            const previous = await current(a);
            const account = await linked(a);

            await expectStatus(() => succeed(a), 409);

            assert.deepEqual(await current(a), previous);
            assert.deepEqual(await linked(a), account);
        });

        await t.test('5 - Token de otra solicitud rechazado', async () => {
            const previous = await current(b);
            const other = acquired.get(c.specialistId);

            await expectStatus(
                () => service.markSucceeded(
                    previous.id,
                    other.processingToken,
                    {
                        stripeAccountId: b.stripeAccountId,
                        country: 'US',
                        livemode: false
                    }
                ),
                409
            );

            assert.deepEqual(await current(b), previous);
            assert.equal(await linked(b), null);
        });

        await t.test('6 - Pais incompatible rechazado', async () => {
            const previous = await current(b);

            await expectStatus(
                () => succeed(b, service, {
                    country: 'ES'
                }),
                409
            );

            assert.deepEqual(await current(b), previous);
            assert.equal(await linked(b), null);
        });

        await t.test('7 - Rollback por cuenta externa duplicada', async () => {
            const previous = await current(b);
            const occupied = await linked(h);

            await expectStatus(
                () => succeed(b, service, {
                    stripeAccountId: h.stripeAccountId
                }),
                409
            );

            // La solicitud no debe quedar SUCCEEDED.
            // El token y el procesamiento deben conservarse.

            assert.deepEqual(await current(b), previous);
            assert.equal(await linked(b), null);
            assert.deepEqual(await linked(h), occupied);
        });

        await t.test('8 - Rollback por identificador de solicitud duplicado', async () => {
            const previous = await current(b);

            await expectStatus(
                () => succeed(b, service, {
                    stripeAccountId: a.stripeAccountId
                }),
                409
            );

            assert.deepEqual(await current(b), previous);
            assert.equal(await linked(b), null);
        });

        await t.test('9 - Rollback ante fallo posterior a ambas escrituras', async () => {
            const previous = await current(c);
            const forcedFailure =
                new Error('FORCED_LOCAL_ROLLBACK');

            let completedInsideTransaction = false;

            const wrappedPrisma = {
                $transaction(callback, options) {
                    return prisma.$transaction(
                        async tx => {
                            await callback(tx);

                            const request =
                                await tx.stripeAccountCreationRequest.findUnique({
                                    where: {
                                        specialistId: c.specialistId
                                    }
                                });

                            const account =
                                await tx.stripeConnectedAccount.findUnique({
                                    where: {
                                        specialistId: c.specialistId
                                    }
                                });

                            assert.equal(
                                request.status,
                                'SUCCEEDED'
                            );

                            assert.equal(
                                account.stripeAccountId,
                                c.stripeAccountId
                            );

                            completedInsideTransaction = true;

                            throw forcedFailure;
                        },
                        options
                    );
                }
            };

            const failingService =
                new StripeAccountCreationRequestService(
                    wrappedPrisma
                );

            await assert.rejects(
                () => succeed(c, failingService),
                error => error === forcedFailure
            );

            assert.equal(
                completedInsideTransaction,
                true
            );

            assert.deepEqual(await current(c), previous);
            assert.equal(await linked(c), null);
        });

        await t.test('10 - Veinte vinculaciones concurrentes', async () => {
            const outcomes = await Promise.allSettled(
                Array.from(
                    { length: 20 },
                    (_, index) => succeed(
                        d,
                        index % 2 === 0
                            ? service
                            : anotherService
                    )
                )
            );

            const accepted = outcomes.filter(
                result => result.status === 'fulfilled'
            );

            const rejected = outcomes.filter(
                result => result.status === 'rejected'
            );

            assert.equal(accepted.length, 1);
            assert.equal(rejected.length, 19);

            for (const item of rejected) {
                assert.equal(
                    item.reason.getStatus(),
                    409
                );
            }

            const request = await current(d);
            const account = await linked(d);

            assert.equal(request.status, 'SUCCEEDED');

            assert.equal(
                request.stripeAccountId,
                d.stripeAccountId
            );

            assert.equal(
                account.stripeAccountId,
                d.stripeAccountId
            );

            assert.equal(
                await prisma.stripeConnectedAccount.count({
                    where: {
                        specialistId: d.specialistId
                    }
                }),
                1
            );
        });

        await t.test('11 - Dos especialistas compiten por una cuenta', async () => {
            const shared =
                'acct_Shared' +
                randomUUID().replace(/-/g, '');

            const previousE = await current(e);
            const previousF = await current(f);

            const outcomes = await Promise.allSettled([
                succeed(e, service, {
                    stripeAccountId: shared
                }),
                succeed(f, anotherService, {
                    stripeAccountId: shared
                })
            ]);

            assert.equal(
                outcomes.filter(
                    item => item.status === 'fulfilled'
                ).length,
                1
            );

            assert.equal(
                outcomes.filter(
                    item => item.status === 'rejected'
                ).length,
                1
            );

            const winnerIndex =
                outcomes[0].status === 'fulfilled'
                    ? 0 : 1;

            const loserIndex = 1 - winnerIndex;

            const winner = [e, f][winnerIndex];
            const loser = [e, f][loserIndex];

            assert.equal(
                outcomes[loserIndex].reason.getStatus(),
                409
            );

            assert.equal(
                (await current(winner)).status,
                'SUCCEEDED'
            );

            assert.equal(
                (await linked(winner)).stripeAccountId,
                shared
            );

            assert.deepEqual(
                await current(loser),
                [previousE, previousF][loserIndex]
            );

            assert.equal(await linked(loser), null);

            assert.equal(
                await prisma.stripeConnectedAccount.count({
                    where: { stripeAccountId: shared }
                }),
                1
            );
        });

        await t.test('12 - Vinculacion previa bloquea finalizacion', async () => {
            await prisma.stripeConnectedAccount.create({
                data: {
                    specialistId: g.specialistId,
                    stripeAccountId:
                        'acct_PreviouslyLinked' +
                        randomUUID().replace(/-/g, ''),
                    country: 'US'
                }
            });

            const previous = await current(g);
            const account = await linked(g);

            await expectStatus(() => succeed(g), 409);

            assert.deepEqual(await current(g), previous);
            assert.deepEqual(await linked(g), account);
        });

        await t.test('13 - Nueva instancia conserva vinculacion', async () => {
            const previous = await current(a);
            const account = await linked(a);

            const restarted =
                new StripeAccountCreationRequestService(
                    anotherPrisma
                );

            await expectStatus(
                () => restarted.acquireProcessing(
                    a.specialistId
                ),
                409
            );

            await expectStatus(
                () => succeed(a, restarted),
                409
            );

            assert.deepEqual(await current(a), previous);
            assert.deepEqual(await linked(a), account);
        });

        await t.test('14 - Desactivacion impide vinculacion', async () => {
            const previous = await current(b);

            process.env.STRIPE_MODE = 'disabled';

            try {
                await expectStatus(
                    () => succeed(b),
                    503
                );
            } finally {
                process.env.STRIPE_MODE = 'test';
            }

            assert.deepEqual(await current(b), previous);
            assert.equal(await linked(b), null);
        });

    } finally {
        process.env.STRIPE_MODE = originalMode;

        try {
            if (initialized) {
                await prisma.$transaction(async tx => {
                    await tx.stripeAccountCreationRequest.deleteMany({
                        where: {
                            specialistId: { in: specialistIds }
                        }
                    });

                    await tx.stripeConnectedAccount.deleteMany({
                        where: {
                            specialistId: { in: specialistIds }
                        }
                    });

                    await tx.specialist.deleteMany({
                        where: {
                            id: { in: specialistIds },
                            userId: { in: userIds }
                        }
                    });

                    await tx.user.deleteMany({
                        where: {
                            id: { in: userIds }
                        }
                    });
                });

                await t.test('15 - Limpieza e inventario conservado', async () => {
                    assert.equal(
                        await prisma.user.count({
                            where: { id: { in: userIds } }
                        }),
                        0
                    );

                    assert.equal(
                        await prisma.specialist.count({
                            where: {
                                id: { in: specialistIds }
                            }
                        }),
                        0
                    );

                    assert.equal(
                        await prisma.stripeAccountCreationRequest.count({
                            where: {
                                specialistId: { in: specialistIds }
                            }
                        }),
                        0
                    );

                    assert.equal(
                        await prisma.stripeConnectedAccount.count({
                            where: {
                                specialistId: { in: specialistIds }
                            }
                        }),
                        0
                    );

                    assert.deepEqual(
                        await inventory(),
                        before
                    );
                });
            }
        } finally {
            await Promise.all([
                prisma.$disconnect(),
                anotherPrisma.$disconnect()
            ]);
        }
    }
});
