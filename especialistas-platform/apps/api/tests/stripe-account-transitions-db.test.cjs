const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('Stripe: transiciones seguras con PostgreSQL', async (t) => {
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
        { length: 6 },
        () => ({
            userId: randomUUID(),
            specialistId: randomUUID()
        })
    );

    const [a, b, c, d, e, f] = fixtures;

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

    function fail(fixture, instance = service) {
        const operation = acquired.get(fixture.specialistId);

        return instance.markFailed(
            operation.requestId,
            operation.processingToken,
            'LOCAL_PRECONDITION_FAILED'
        );
    }

    function uncertain(fixture, instance = service) {
        const operation = acquired.get(fixture.specialistId);

        return instance.markUncertain(
            operation.requestId,
            operation.processingToken,
            'EXTERNAL_RESULT_UNKNOWN'
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
        assert.equal(updated.stripeAccountId, null);
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
                        name: 'Temporary Stripe transitions test',
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
        }

        for (const fixture of [a, b, c, d, e]) {
            acquired.set(
                fixture.specialistId,
                await service.acquireProcessing(
                    fixture.specialistId
                )
            );
        }

        await t.test('1 - Fallo definitivo persistente', async () => {
            const previous = await current(a);
            const result = await fail(a);
            const row = await current(a);

            assert.equal(result.transitioned, true);
            assert.equal(row.status, 'FAILED');
            assert.equal(
                row.lastErrorCode,
                'LOCAL_PRECONDITION_FAILED'
            );

            assert.ok(row.completedAt instanceof Date);

            assert.deepEqual(
                row.completedAt,
                result.completedAt
            );

            verifyHistory(previous, row);
        });

        await t.test('2 - Resultado incierto persistente', async () => {
            const previous = await current(b);
            const result = await uncertain(b);
            const row = await current(b);

            assert.equal(result.transitioned, true);
            assert.equal(row.status, 'UNCERTAIN');
            assert.equal(row.completedAt, null);

            assert.equal(
                row.lastErrorCode,
                'EXTERNAL_RESULT_UNKNOWN'
            );

            verifyHistory(previous, row);
        });

        await t.test('3 - Token incorrecto rechazado', async () => {
            const previous = await current(c);

            await expectStatus(
                () => service.markFailed(
                    previous.id,
                    randomUUID(),
                    'LOCAL_PRECONDITION_FAILED'
                ),
                409
            );

            assert.deepEqual(
                await current(c),
                previous
            );
        });

        await t.test('4 - Token de otra solicitud rechazado', async () => {
            const previous = await current(c);

            const other = acquired.get(d.specialistId);

            await expectStatus(
                () => service.markUncertain(
                    previous.id,
                    other.processingToken,
                    'EXTERNAL_RESULT_UNKNOWN'
                ),
                409
            );

            assert.deepEqual(
                await current(c),
                previous
            );
        });

        await t.test('5 - Token utilizado no puede repetirse', async () => {
            const previous = await current(a);

            await expectStatus(() => fail(a), 409);
            await expectStatus(() => uncertain(a), 409);

            assert.deepEqual(
                await current(a),
                previous
            );
        });

        await t.test('6 - Solicitud incierta no puede reprocesarse', async () => {
            const previous = await current(b);

            await expectStatus(
                () => service.acquireProcessing(
                    b.specialistId
                ),
                409
            );

            await expectStatus(
                () => fail(b),
                409
            );

            assert.deepEqual(
                await current(b),
                previous
            );
        });

        await t.test('7 - Veinte transiciones concurrentes', async () => {
            const previous = await current(c);

            const outcomes = await Promise.allSettled(
                Array.from(
                    { length: 20 },
                    (_, index) => index % 2 === 0
                        ? fail(c, service)
                        : uncertain(c, anotherService)
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
            const winner = accepted[0].value;

            assert.equal(row.status, winner.status);

            assert.equal(
                row.lastErrorCode,
                winner.lastErrorCode
            );

            assert.deepEqual(
                row.completedAt,
                winner.completedAt
            );

            verifyHistory(previous, row);
        });

        await t.test('8 - Desactivacion impide transicion', async () => {
            const previous = await current(d);

            process.env.STRIPE_MODE = 'disabled';

            try {
                await expectStatus(() => fail(d), 503);
                await expectStatus(() => uncertain(d), 503);
            } finally {
                process.env.STRIPE_MODE = 'test';
            }

            assert.deepEqual(
                await current(d),
                previous
            );
        });

        await t.test('9 - Solicitud real no puede modificarse', async () => {
            const previous =
                await prisma.stripeAccountCreationRequest.update({
                    where: {
                        specialistId: e.specialistId
                    },
                    data: {
                        livemode: true
                    }
                });

            await expectStatus(() => fail(e), 409);
            await expectStatus(() => uncertain(e), 409);

            assert.deepEqual(
                await current(e),
                previous
            );
        });

        await t.test('10 - Solicitud pendiente no puede finalizarse', async () => {
            const previous = await current(f);

            await expectStatus(
                () => service.markFailed(
                    previous.id,
                    randomUUID(),
                    'LOCAL_PRECONDITION_FAILED'
                ),
                409
            );

            assert.deepEqual(
                await current(f),
                previous
            );
        });

        await t.test('11 - Clave incompatible bloquea transicion', async () => {
            const previous =
                await prisma.stripeAccountCreationRequest.update({
                    where: {
                        specialistId: d.specialistId
                    },
                    data: {
                        idempotencyKey:
                            'invalid-' + randomUUID()
                    }
                });

            await expectStatus(() => fail(d), 409);

            assert.deepEqual(
                await current(d),
                previous
            );
        });

        await t.test('12 - Nueva instancia conserva estados finales', async () => {
            const restarted =
                new StripeAccountCreationRequestService(
                    anotherPrisma
                );

            for (const fixture of [a, b, c]) {
                const previous = await current(fixture);

                await expectStatus(
                    () => restarted.acquireProcessing(
                        fixture.specialistId
                    ),
                    409
                );

                assert.deepEqual(
                    await current(fixture),
                    previous
                );
            }
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

                await t.test('13 - Limpieza e inventario conservado', async () => {
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
