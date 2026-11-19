const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('Stripe: integracion y concurrencia de solicitudes', async (t) => {
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

    const prisma = new PrismaClient({
        adapter: new PrismaPg({
            connectionString: process.env.DATABASE_URL
        })
    });

    const originalMode = process.env.STRIPE_MODE;

    const fixtures = Array.from(
        { length: 4 },
        () => ({
            userId: randomUUID(),
            specialistId: randomUUID()
        })
    );

    const [a, b, c, d] = fixtures;

    const specialistIds = fixtures.map(
        item => item.specialistId
    );

    const userIds = fixtures.map(
        item => item.userId
    );

    let initialized = false;
    let before;
    let firstRequest;

    const service =
        new StripeAccountCreationRequestService(prisma);

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

    function register(fixture, country = 'US') {
        return service.registerRequest(
            fixture.specialistId,
            country
        );
    }

    function current(fixture) {
        return prisma.stripeAccountCreationRequest.findUnique({
            where: {
                specialistId: fixture.specialistId
            }
        });
    }

    async function expectStatus(operation, status) {
        await assert.rejects(operation, error => {
            assert.equal(error.getStatus(), status);
            return true;
        });
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
            schema: 'public'
        });

        before = await inventory();

        await prisma.$transaction(async tx => {
            for (const fixture of fixtures) {
                await tx.user.create({
                    data: {
                        id: fixture.userId,
                        name: 'Temporary Stripe registration test',
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
                    specialistId: d.specialistId,
                    country: 'US',
                    stripeAccountId:
                        'acct_Fictitious' +
                        randomUUID().replace(/-/g, '')
                }
            });
        });

        initialized = true;

        process.env.STRIPE_MODE = 'test';

        await t.test('1 - Registro persistente inicial', async () => {
            const result = await register(a);

            assert.equal(result.created, true);

            firstRequest = result.request;

            const saved = await current(a);

            assert.deepEqual(saved, firstRequest);
            assert.equal(saved.status, 'PENDING');
            assert.equal(saved.livemode, false);
            assert.equal(saved.attemptCount, 0);

            assert.match(
                saved.idempotencyKey,
                /^connectpro:test:v1:connected-account-create:[a-f0-9]{64}$/
            );
        });

        await t.test('2 - Reintento conserva solicitud', async () => {
            const result = await register(a);

            assert.equal(result.created, false);
            assert.deepEqual(result.request, firstRequest);

            assert.equal(
                await prisma.stripeAccountCreationRequest.count({
                    where: {
                        specialistId: a.specialistId
                    }
                }),
                1
            );
        });

        await t.test('3 - Nueva instancia recupera la solicitud', async () => {
            const another =
                new StripeAccountCreationRequestService(prisma);

            const result = await another.registerRequest(
                a.specialistId,
                'US'
            );

            assert.equal(result.created, false);
            assert.deepEqual(result.request, firstRequest);
        });

        await t.test('4 - Veinte solicitudes simultaneas', async () => {
            const outcomes = await Promise.allSettled(
                Array.from(
                    { length: 20 },
                    () => register(b)
                )
            );

            const rejected = outcomes.filter(
                item => item.status === 'rejected'
            );

            assert.equal(rejected.length, 0);

            const results = outcomes.map(
                item => item.value
            );

            assert.equal(
                results.filter(result => result.created).length,
                1
            );

            assert.equal(
                new Set(results.map(
                    result => result.request.id
                )).size,
                1
            );

            assert.equal(
                new Set(results.map(
                    result => result.request.idempotencyKey
                )).size,
                1
            );

            assert.equal(
                await prisma.stripeAccountCreationRequest.count({
                    where: {
                        specialistId: b.specialistId
                    }
                }),
                1
            );
        });

        await t.test('5 - Paises concurrentes incompatibles', async () => {
            const countries = Array.from(
                { length: 12 },
                (_, index) => index % 2 === 0 ? 'US' : 'ES'
            );

            const outcomes = await Promise.allSettled(
                countries.map(country => register(c, country))
            );

            const saved = await current(c);

            assert.ok(saved);
            assert.ok(['US', 'ES'].includes(saved.country));

            let created = 0;

            for (let i = 0; i < outcomes.length; i++) {
                const outcome = outcomes[i];

                if (countries[i] === saved.country) {
                    assert.equal(outcome.status, 'fulfilled');

                    assert.equal(
                        outcome.value.request.id,
                        saved.id
                    );

                    if (outcome.value.created)
                        created++;
                } else {
                    assert.equal(outcome.status, 'rejected');
                    assert.equal(
                        outcome.reason.getStatus(),
                        409
                    );
                }
            }

            assert.equal(created, 1);

            assert.equal(
                await prisma.stripeAccountCreationRequest.count({
                    where: {
                        specialistId: c.specialistId
                    }
                }),
                1
            );
        });

        await t.test('6 - Claves independientes por especialista', async () => {
            const rows =
                await prisma.stripeAccountCreationRequest.findMany({
                    where: {
                        specialistId: {
                            in: [
                                a.specialistId,
                                b.specialistId,
                                c.specialistId
                            ]
                        }
                    }
                });

            assert.equal(rows.length, 3);

            assert.equal(
                new Set(rows.map(
                    row => row.idempotencyKey
                )).size,
                3
            );
        });

        await t.test('7 - Cuenta vinculada impide nueva solicitud', async () => {
            await expectStatus(
                () => register(d),
                409
            );

            assert.equal(await current(d), null);
        });

        await t.test('8 - Solicitud incierta permanece bloqueada', async () => {
            const changed =
                await prisma.stripeAccountCreationRequest.update({
                    where: {
                        specialistId: a.specialistId
                    },
                    data: {
                        status: 'UNCERTAIN',
                        attemptCount: 1,
                        firstAttemptAt: new Date(),
                        lastAttemptAt: new Date(),
                        lastErrorCode: 'TEST_UNCERTAIN'
                    }
                });

            const result = await register(a);

            assert.equal(result.created, false);
            assert.deepEqual(result.request, changed);
            assert.deepEqual(await current(a), changed);

            assert.equal(
                result.request.idempotencyKey,
                firstRequest.idempotencyKey
            );
        });

        await t.test('9 - Cambio posterior de pais rechazado', async () => {
            const previous = await current(a);

            await expectStatus(
                () => register(a, 'MX'),
                409
            );

            assert.deepEqual(await current(a), previous);
        });

        await t.test('10 - Especialista inexistente rechazado', async () => {
            await expectStatus(
                () => service.registerRequest(
                    randomUUID(),
                    'US'
                ),
                404
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

                await t.test('11 - Limpieza e inventario conservado', async () => {
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

                    assert.deepEqual(await inventory(), before);
                });
            }
        } finally {
            await prisma.$disconnect();
        }
    }
});
