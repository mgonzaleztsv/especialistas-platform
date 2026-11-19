const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('Stripe: procesamiento exclusivo con PostgreSQL', async (t) => {
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
    let winner;
    let initialRequest;

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

    function acquire(fixture, instance = service) {
        return instance.acquireProcessing(
            fixture.specialistId
        );
    }

    function current(fixture) {
        return prisma.stripeAccountCreationRequest.findUnique({
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

    async function expectStatus(operation, status) {
        await assert.rejects(operation, error => {
            assert.equal(error.getStatus(), status);
            return true;
        });
    }

    try {
        for (const connection of [
            prisma,
            anotherPrisma
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
                        name: 'Temporary Stripe processing test',
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

        for (const fixture of [a, b, c, d, e]) {
            await service.registerRequest(
                fixture.specialistId,
                'US'
            );
        }

        initialRequest = await current(a);

        await t.test('1 - Veinte adquisiciones simultaneas', async () => {
            const outcomes = await Promise.allSettled(
                Array.from(
                    { length: 20 },
                    (_, index) => acquire(
                        a,
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

            for (const result of rejected) {
                assert.equal(
                    result.reason.getStatus(),
                    409
                );
            }

            winner = accepted[0].value;

            assert.equal(winner.acquired, true);
            assert.equal(winner.attemptCount, 1);
        });

        await t.test('2 - Token exclusivo persistente', async () => {
            const row = await current(a);

            assert.equal(row.status, 'PROCESSING');
            assert.equal(row.attemptCount, 1);
            assert.equal(
                row.processingToken,
                winner.processingToken
            );

            assert.match(
                row.processingToken,
                /^[a-f0-9-]{36}$/
            );

            assert.equal(
                row.idempotencyKey,
                initialRequest.idempotencyKey
            );

            assert.equal(
                row.idempotencyKey,
                winner.idempotencyKey
            );
        });

        await t.test('3 - Fechas de procesamiento coherentes', async () => {
            const row = await current(a);

            for (const field of [
                'processingAt',
                'firstAttemptAt',
                'lastAttemptAt'
            ]) {
                assert.equal(
                    row[field].getTime(),
                    winner.processingAt.getTime()
                );
            }

            assert.equal(row.completedAt, null);
            assert.equal(row.stripeAccountId, null);
            assert.equal(row.lastErrorCode, null);
        });

        await t.test('4 - Repeticion no modifica procesamiento', async () => {
            const previous = await current(a);

            await expectStatus(
                () => acquire(a),
                409
            );

            assert.deepEqual(
                await current(a),
                previous
            );
        });

        await t.test('5 - Nueva instancia no adquiere nuevamente', async () => {
            const previous = await current(a);

            const restarted =
                new StripeAccountCreationRequestService(
                    anotherPrisma
                );

            await expectStatus(
                () => acquire(a, restarted),
                409
            );

            assert.deepEqual(
                await current(a),
                previous
            );
        });

        await t.test('6 - Cuenta vinculada bloquea adquisicion', async () => {
            await prisma.stripeConnectedAccount.create({
                data: {
                    specialistId: b.specialistId,
                    country: 'US',
                    stripeAccountId:
                        'acct_Fictitious' +
                        randomUUID().replace(/-/g, '')
                }
            });

            const previous = await current(b);

            await expectStatus(
                () => acquire(b),
                409
            );

            assert.deepEqual(
                await current(b),
                previous
            );
        });

        await t.test('7 - Estados finales e inciertos bloqueados', async () => {
            for (const status of [
                'FAILED',
                'UNCERTAIN',
                'SUCCEEDED'
            ]) {
                const previous = await modify(c, {
                    status,
                    attemptCount: 1
                });

                await expectStatus(
                    () => acquire(c),
                    409
                );

                assert.deepEqual(
                    await current(c),
                    previous
                );
            }
        });

        await t.test('8 - Solicitud pendiente con intento anterior', async () => {
            const previous = await modify(d, {
                attemptCount: 1,
                firstAttemptAt: new Date()
            });

            await expectStatus(
                () => acquire(d),
                409
            );

            assert.deepEqual(
                await current(d),
                previous
            );
        });

        await t.test('9 - Clave incompatible bloqueada', async () => {
            const previous = await modify(e, {
                idempotencyKey:
                    'invalid-' + randomUUID()
            });

            await expectStatus(
                () => acquire(e),
                409
            );

            assert.deepEqual(
                await current(e),
                previous
            );
        });

        await t.test('10 - Solicitud real bloqueada', async () => {
            const previous = await modify(e, {
                livemode: true
            });

            await expectStatus(
                () => acquire(e),
                409
            );

            assert.deepEqual(
                await current(e),
                previous
            );
        });

        await t.test('11 - Solicitud inexistente rechazada', async () => {
            await expectStatus(
                () => acquire(f),
                404
            );
        });

        await t.test('12 - Desactivacion respetada', async () => {
            const previous = await current(a);

            process.env.STRIPE_MODE = 'disabled';

            try {
                await expectStatus(
                    () => acquire(a),
                    503
                );
            } finally {
                process.env.STRIPE_MODE = 'test';
            }

            assert.deepEqual(
                await current(a),
                previous
            );
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
