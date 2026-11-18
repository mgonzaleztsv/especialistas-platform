const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('Stripe Connect: integracion del servicio con PostgreSQL', async (t) => {
    assert.equal(process.env.NODE_ENV, 'test');
    assert.equal(process.env.STRIPE_MODE, 'disabled');
    assert.equal(process.env.INTERNAL_MVP_PAYMENTS_ENABLED, 'false');
    assert.equal(process.env.WORK_ORDER_EXPIRATION_ENABLED, 'false');

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
        StripeConnectedAccountService
    } = require('../dist/payments/stripe-connected-account.service.js');

    const adapter = new PrismaPg({
        connectionString: process.env.DATABASE_URL
    });

    const prisma = new PrismaClient({ adapter });

    const users = [randomUUID(), randomUUID()];
    const specialists = [randomUUID(), randomUUID()];
    const stripeAccountId =
        'acct_fictitious_' + randomUUID().replace(/-/g, '');

    const rollback = new Error('EXPECTED_TEST_ROLLBACK');

    const originalMode = process.env.STRIPE_MODE;

    async function inventory() {
        const rows = await prisma.$queryRaw`
            SELECT
                (SELECT COUNT(*)::int FROM public."User")
                    AS users,
                (SELECT COUNT(*)::int FROM public."Specialist")
                    AS specialists,
                (SELECT COUNT(*)::int FROM public."StripeConnectedAccount")
                    AS accounts,
                (SELECT COUNT(*)::int FROM public."Payment")
                    AS payments,
                (SELECT COUNT(*)::int FROM public."PaymentMovement")
                    AS movements
        `;

        return rows[0];
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

        const before = await inventory();

        process.env.STRIPE_MODE = 'test';

        await assert.rejects(
            () => prisma.$transaction(async (tx) => {
                const service =
                    new StripeConnectedAccountService(tx);

                for (let i = 0; i < 2; i++) {
                    await tx.user.create({
                        data: {
                            id: users[i],
                            name: 'Temporary Stripe service test',
                            email: users[i] + '@example.invalid',
                            passwordHash: 'NOT_A_VALID_PASSWORD_HASH',
                            role: 'SPECIALIST'
                        }
                    });

                    await tx.specialist.create({
                        data: {
                            id: specialists[i],
                            userId: users[i]
                        }
                    });
                }

                await t.test('1 - Especialista sin cuenta', async () => {
                    assert.deepEqual(
                        await service.getTransferReadiness(specialists[0]),
                        {
                            eligible: false,
                            reasons: ['ACCOUNT_NOT_FOUND']
                        }
                    );
                });

                await tx.stripeConnectedAccount.create({
                    data: {
                        specialistId: specialists[0],
                        stripeAccountId,
                        country: 'US'
                    }
                });

                await t.test('2 - Consulta real mediante Prisma', async () => {
                    const account =
                        await service.findBySpecialistId(specialists[0]);

                    assert.equal(account.specialistId, specialists[0]);
                    assert.equal(account.stripeAccountId, stripeAccountId);
                    assert.equal(account.livemode, false);
                    assert.equal(account.payoutsEnabled, false);
                });

                await t.test('3 - Cuenta inicial no elegible', async () => {
                    assert.deepEqual(
                        await service.getTransferReadiness(specialists[0]),
                        {
                            eligible: false,
                            reasons: [
                                'DETAILS_NOT_SUBMITTED',
                                'TRANSFERS_NOT_ACTIVE',
                                'PAYOUTS_NOT_ENABLED',
                                'ACCOUNT_SYNC_REQUIRED'
                            ]
                        }
                    );
                });

                await t.test('4 - Aislamiento entre especialistas', async () => {
                    assert.equal(
                        await service.findBySpecialistId(specialists[1]),
                        null
                    );
                });

                await tx.stripeConnectedAccount.update({
                    where: { specialistId: specialists[0] },
                    data: {
                        detailsSubmitted: true,
                        payoutsEnabled: true,
                        transfersCapability: 'active',
                        lastSyncedAt: new Date()
                    }
                });

                await t.test('5 - Cuenta de prueba elegible', async () => {
                    assert.deepEqual(
                        await service.getTransferReadiness(specialists[0]),
                        {
                            eligible: true,
                            reasons: []
                        }
                    );
                });

                await tx.stripeConnectedAccount.update({
                    where: { specialistId: specialists[0] },
                    data: {
                        lastSyncedAt: new Date(
                            Date.now() - 16 * 60 * 1000
                        )
                    }
                });

                await t.test('6 - Sincronizacion vencida rechazada', async () => {
                    assert.deepEqual(
                        await service.getTransferReadiness(specialists[0]),
                        {
                            eligible: false,
                            reasons: ['ACCOUNT_SYNC_REQUIRED']
                        }
                    );
                });

                await tx.stripeConnectedAccount.update({
                    where: { specialistId: specialists[0] },
                    data: {
                        livemode: true,
                        lastSyncedAt: new Date()
                    }
                });

                await t.test('7 - Cuenta real rechazada', async () => {
                    assert.deepEqual(
                        await service.getTransferReadiness(specialists[0]),
                        {
                            eligible: false,
                            reasons: ['LIVE_ACCOUNT_NOT_ALLOWED']
                        }
                    );
                });

                await t.test('8 - Stripe desactivado', async () => {
                    process.env.STRIPE_MODE = 'disabled';

                    try {
                        await assert.rejects(
                            () => service.getTransferReadiness(specialists[0]),
                            error => error.getStatus() === 503
                        );
                    } finally {
                        process.env.STRIPE_MODE = 'test';
                    }
                });

                throw rollback;

            }, {
                isolationLevel: 'Serializable',
                maxWait: 5000,
                timeout: 20000
            }),
            error => error === rollback
        );

        await t.test('9 - Rollback sin registros residuales', async () => {
            assert.equal(
                await prisma.user.count({
                    where: { id: { in: users } }
                }),
                0
            );

            assert.equal(
                await prisma.specialist.count({
                    where: { id: { in: specialists } }
                }),
                0
            );

            assert.equal(
                await prisma.stripeConnectedAccount.count({
                    where: {
                        OR: [
                            { specialistId: { in: specialists } },
                            { stripeAccountId }
                        ]
                    }
                }),
                0
            );
        });

        await t.test('10 - Inventario financiero conservado', async () => {
            assert.deepEqual(await inventory(), before);
        });

    } finally {
        process.env.STRIPE_MODE = originalMode;
        await prisma.$disconnect();
    }
});
