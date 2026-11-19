const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('Stripe: recuperacion segura con PostgreSQL', async (t) => {
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

    const originalMode = process.env.STRIPE_MODE;

    const fixtures = Array.from(
        { length: 9 },
        () => ({
            userId: randomUUID(),
            specialistId: randomUUID(),
            stripeAccountId:
                'acct_Fictitious' +
                randomUUID().replace(/-/g, '')
        })
    );

    const [a, b, c, d, e, f, g, h, i] = fixtures;

    const specialistIds = fixtures.map(
        item => item.specialistId
    );

    const userIds = fixtures.map(
        item => item.userId
    );

    const acquired = new Map();

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

    function modify(fixture, data) {
        return prisma.stripeAccountCreationRequest.update({
            where: {
                specialistId: fixture.specialistId
            },
            data
        });
    }

    async function age(fixture, minutes = 31) {
        const previous =
            new Date(Date.now() - minutes * 60000);

        return modify(fixture, {
            processingAt: previous,
            firstAttemptAt: previous,
            lastAttemptAt: previous
        });
    }

    function abandon(fixture, instance = service) {
        const operation =
            acquired.get(fixture.specialistId);

        return instance.markAbandonedProcessing(
            operation.requestId
        );
    }

    function succeed(fixture, instance = service) {
        const operation =
            acquired.get(fixture.specialistId);

        return instance.markSucceeded(
            operation.requestId,
            operation.processingToken,
            {
                stripeAccountId: fixture.stripeAccountId,
                country: 'US',
                livemode: false
            }
        );
    }

    function fail(fixture) {
        const operation =
            acquired.get(fixture.specialistId);

        return service.markFailed(
            operation.requestId,
            operation.processingToken,
            'LOCAL_PRECONDITION_FAILED'
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
    }

    try {
        for (const connection of [
            prisma, anotherPrisma
        ]) {
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
                        name: 'Temporary Stripe recovery test',
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
        });

        initialized = true;

        process.env.STRIPE_MODE = 'test';

        for (const fixture of fixtures) {
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

        await t.test('1 - Procesamiento reciente protegido', async () => {
            const previous = await current(a);

            await expectStatus(
                () => abandon(a),
                409
            );

            assert.deepEqual(await current(a), previous);
        });

        await t.test('2 - Procesamiento abandonado recuperado', async () => {
            const previous = await age(b);

            const result = await abandon(b);
            const row = await current(b);

            assert.equal(result.transitioned, true);
            assert.equal(row.status, 'UNCERTAIN');

            assert.equal(
                row.lastErrorCode,
                'LOCAL_PROCESSING_ABANDONED'
            );

            assert.equal(row.completedAt, null);
            assert.equal(row.stripeAccountId, null);

            verifyHistory(previous, row);
        });

        await t.test('3 - Segundo intento de recuperacion rechazado', async () => {
            const previous = await current(b);

            await expectStatus(
                () => abandon(b),
                409
            );

            assert.deepEqual(await current(b), previous);
        });

        await t.test('4 - Reprocesamiento automatico bloqueado', async () => {
            const previous = await current(b);

            await expectStatus(
                () => anotherService.acquireProcessing(
                    b.specialistId
                ),
                409
            );

            assert.deepEqual(await current(b), previous);
        });

        await t.test('5 - Respuesta exitosa tardia rechazada', async () => {
            const previous = await current(b);

            await expectStatus(
                () => succeed(b),
                409
            );

            assert.deepEqual(await current(b), previous);
            assert.equal(await linked(b), null);
        });

        await t.test('6 - Token anterior no puede registrar fallo', async () => {
            const previous = await current(b);

            await expectStatus(
                () => fail(b),
                409
            );

            assert.deepEqual(await current(b), previous);
        });

        await t.test('7 - Veinte recuperaciones simultaneas', async () => {
            const previous = await age(c);

            const outcomes = await Promise.allSettled(
                Array.from(
                    { length: 20 },
                    (_, index) => abandon(
                        c,
                        index % 2 === 0
                            ? service
                            : anotherService
                    )
                )
            );

            const accepted = outcomes.filter(
                item => item.status === 'fulfilled'
            );

            const rejected = outcomes.filter(
                item => item.status === 'rejected'
            );

            assert.equal(accepted.length, 1);
            assert.equal(rejected.length, 19);

            for (const item of rejected) {
                assert.equal(
                    item.reason.getStatus(),
                    409
                );
            }

            const row = await current(c);

            assert.equal(row.status, 'UNCERTAIN');

            verifyHistory(previous, row);
        });

        await t.test('8 - Recuperacion compite con vinculacion exitosa', async () => {
            const previous = await age(d);

            const outcomes = await Promise.allSettled([
                abandon(d, service),
                succeed(d, anotherService)
            ]);

            assert.equal(
                outcomes.filter(
                    item => item.status === 'fulfilled'
                ).length,
                1
            );

            const rejected = outcomes.find(
                item => item.status === 'rejected'
            );

            assert.equal(
                rejected.reason.getStatus(),
                409
            );

            const row = await current(d);
            const account = await linked(d);

            verifyHistory(previous, row);

            if (outcomes[0].status === 'fulfilled') {
                assert.equal(row.status, 'UNCERTAIN');
                assert.equal(row.stripeAccountId, null);
                assert.equal(account, null);
                assert.equal(row.completedAt, null);
            } else {
                assert.equal(row.status, 'SUCCEEDED');
                assert.ok(account);
                assert.equal(
                    account.stripeAccountId,
                    d.stripeAccountId
                );
                assert.equal(
                    row.stripeAccountId,
                    d.stripeAccountId
                );
                assert.ok(row.completedAt instanceof Date);
            }
        });

        await t.test('9 - Recuperacion compite con fallo definitivo', async () => {
            const previous = await age(e);

            const outcomes = await Promise.allSettled([
                abandon(e, anotherService),
                fail(e)
            ]);

            assert.equal(
                outcomes.filter(
                    item => item.status === 'fulfilled'
                ).length,
                1
            );

            const rejected = outcomes.find(
                item => item.status === 'rejected'
            );

            assert.equal(
                rejected.reason.getStatus(),
                409
            );

            const row = await current(e);

            if (outcomes[0].status === 'fulfilled') {
                assert.equal(row.status, 'UNCERTAIN');
                assert.equal(row.completedAt, null);

                assert.equal(
                    row.lastErrorCode,
                    'LOCAL_PROCESSING_ABANDONED'
                );
            } else {
                assert.equal(row.status, 'FAILED');
                assert.ok(row.completedAt instanceof Date);

                assert.equal(
                    row.lastErrorCode,
                    'LOCAL_PRECONDITION_FAILED'
                );
            }

            assert.equal(await linked(e), null);

            verifyHistory(previous, row);
        });

        await t.test('10 - Cuenta vinculada impide recuperacion', async () => {
            await age(f);

            await prisma.stripeConnectedAccount.create({
                data: {
                    specialistId: f.specialistId,
                    stripeAccountId: f.stripeAccountId,
                    country: 'US'
                }
            });

            const previous = await current(f);
            const account = await linked(f);

            await expectStatus(
                () => abandon(f),
                409
            );

            assert.deepEqual(await current(f), previous);
            assert.deepEqual(await linked(f), account);
        });

        await t.test('11 - Historial inconsistente protegido', async () => {
            await age(g);

            const previous = await modify(g, {
                firstAttemptAt:
                    new Date(Date.now() - 40 * 60000)
            });

            await expectStatus(
                () => abandon(g),
                409
            );

            assert.deepEqual(await current(g), previous);
        });

        await t.test('12 - Solicitud real protegida', async () => {
            await age(h);

            const previous = await modify(h, {
                livemode: true
            });

            await expectStatus(
                () => abandon(h),
                409
            );

            assert.deepEqual(await current(h), previous);
        });

        await t.test('13 - Desactivacion del servicio respetada', async () => {
            const previous = await age(i);

            process.env.STRIPE_MODE = 'disabled';

            try {
                await expectStatus(
                    () => abandon(i),
                    503
                );
            } finally {
                process.env.STRIPE_MODE = 'test';
            }

            assert.deepEqual(await current(i), previous);
        });

        await t.test('14 - Solicitud completada no puede recuperarse', async () => {
            await succeed(a);

            const previous = await current(a);
            const account = await linked(a);

            await expectStatus(
                () => abandon(a),
                409
            );

            assert.deepEqual(await current(a), previous);
            assert.deepEqual(await linked(a), account);
        });

        await t.test('15 - Nueva instancia conserva incertidumbre', async () => {
            const restarted =
                new StripeAccountCreationRequestService(
                    anotherPrisma
                );

            const previous = await current(b);

            const result = await restarted.registerRequest(
                b.specialistId,
                'US'
            );

            assert.equal(result.created, false);
            assert.deepEqual(result.request, previous);

            await expectStatus(
                () => restarted.acquireProcessing(
                    b.specialistId
                ),
                409
            );

            assert.deepEqual(await current(b), previous);
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

                await t.test('16 - Limpieza e inventario conservado', async () => {
                    assert.equal(
                        await prisma.user.count({
                            where: {
                                id: { in: userIds }
                            }
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
