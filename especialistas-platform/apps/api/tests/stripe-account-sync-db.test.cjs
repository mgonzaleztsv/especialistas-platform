const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('Stripe Connect: sincronizacion y concurrencia DB', async (t) => {
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
        StripeAccountSyncService
    } = require('../dist/payments/stripe-account-sync.service.js');

    const {
        StripeConnectedAccountService
    } = require('../dist/payments/stripe-connected-account.service.js');

    const prisma = new PrismaClient({
        adapter: new PrismaPg({
            connectionString: process.env.DATABASE_URL
        })
    });

    const userId = randomUUID();
    const specialistId = randomUUID();
    const stripeAccountId =
        'acct_Fictitious' + randomUUID().replace(/-/g, '');

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
                (SELECT COUNT(*)::int FROM public."Payment")
                    AS payments,
                (SELECT COUNT(*)::int FROM public."PaymentMovement")
                    AS movements
        `;

        return rows[0];
    }

    function snapshot(date, enabled = true) {
        return {
            stripeAccountId,
            country: 'US',
            livemode: false,
            detailsSubmitted: enabled,
            chargesEnabled: false,
            payoutsEnabled: enabled,
            transfersCapability: enabled ? 'active' : 'inactive',
            lastSyncedAt: date
        };
    }

    const accounts = new StripeConnectedAccountService(prisma);

    function service(reader) {
        return new StripeAccountSyncService(
            prisma, accounts, reader
        );
    }

    function sync(value) {
        return service({
            retrieveAccountSnapshot: async id => {
                assert.equal(id, stripeAccountId);
                return value;
            }
        }).syncBySpecialistId(specialistId);
    }

    function current() {
        return prisma.stripeConnectedAccount.findUnique({
            where: { specialistId }
        });
    }

    function deferred() {
        let resolve;
        const promise = new Promise(r => { resolve = r; });
        return { promise, resolve };
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
            await tx.user.create({
                data: {
                    id: userId,
                    name: 'Temporary Stripe concurrency test',
                    email: userId + '@example.invalid',
                    passwordHash: 'NOT_A_VALID_PASSWORD_HASH',
                    role: 'SPECIALIST'
                }
            });

            await tx.specialist.create({
                data: { id: specialistId, userId }
            });

            await tx.stripeConnectedAccount.create({
                data: {
                    specialistId,
                    stripeAccountId,
                    country: 'US'
                }
            });
        });

        initialized = true;
        process.env.STRIPE_MODE = 'test';

        const base = Date.now() - 60000;

        await t.test('1 - Sincronizacion inicial', async () => {
            const date = new Date(base);

            await sync(snapshot(date));

            const row = await current();

            assert.equal(row.payoutsEnabled, true);
            assert.equal(row.transfersCapability, 'active');
            assert.equal(row.lastSyncedAt.getTime(), date.getTime());
        });

        await t.test('2 - Elegibilidad posterior', async () => {
            assert.deepEqual(
                await accounts.getTransferReadiness(specialistId),
                { eligible: true, reasons: [] }
            );
        });

        await t.test('3 - Respuesta antigua rechazada', async () => {
            const old = await current();

            await assert.rejects(
                () => sync(snapshot(new Date(base - 1000), false)),
                error => error.getStatus() === 409
            );

            assert.deepEqual(await current(), old);
        });

        await t.test('4 - Fecha identica rechazada', async () => {
            const old = await current();

            await assert.rejects(
                () => sync(snapshot(old.lastSyncedAt, false)),
                error => error.getStatus() === 409
            );

            assert.deepEqual(await current(), old);
        });

        await t.test('5 - Respuesta concurrente tardia', async () => {
            const waiting = deferred();
            const entered = deferred();

            const older = snapshot(new Date(base + 1000), true);
            const newer = snapshot(new Date(base + 2000), false);

            const oldService = service({
                async retrieveAccountSnapshot() {
                    entered.resolve();
                    await waiting.promise;
                    return older;
                }
            });

            const pending = oldService
                .syncBySpecialistId(specialistId)
                .then(
                    value => ({ value }),
                    error => ({ error })
                );

            let timer;

            try {
                await Promise.race([
                    entered.promise,
                    pending.then(() => {
                        throw new Error('Consulta finalizo prematuramente');
                    }),
                    new Promise((_, reject) => {
                        timer = setTimeout(
                            () => reject(new Error('Timeout de consulta')),
                            5000
                        );
                    })
                ]);

                await sync(newer);

                const row = await current();

                assert.equal(row.payoutsEnabled, false);
                assert.equal(row.transfersCapability, 'inactive');

            } finally {
                clearTimeout(timer);
                waiting.resolve();
                await pending;
            }

            const outcome = await pending;

            assert.ok(outcome.error);
            assert.equal(outcome.error.getStatus(), 409);

            const final = await current();

            assert.equal(final.payoutsEnabled, false);
            assert.equal(final.transfersCapability, 'inactive');
            assert.equal(
                final.lastSyncedAt.getTime(),
                newer.lastSyncedAt.getTime()
            );
        });

        await t.test('6 - Revocacion conserva inelegibilidad', async () => {
            const readiness =
                await accounts.getTransferReadiness(specialistId);

            assert.equal(readiness.eligible, false);
            assert.ok(
                readiness.reasons.includes('TRANSFERS_NOT_ACTIVE')
            );
            assert.ok(
                readiness.reasons.includes('PAYOUTS_NOT_ENABLED')
            );
        });

        await t.test('7 - Vinculacion modificada durante consulta', async () => {
            const replacement =
                'acct_Replacement' +
                randomUUID().replace(/-/g, '');

            const changingService = service({
                async retrieveAccountSnapshot() {
                    await prisma.stripeConnectedAccount.update({
                        where: { specialistId },
                        data: {
                            stripeAccountId: replacement
                        }
                    });

                    return snapshot(new Date(base + 3000));
                }
            });

            await assert.rejects(
                () => changingService.syncBySpecialistId(specialistId),
                error => error.getStatus() === 409
            );

            const row = await current();

            assert.equal(row.stripeAccountId, replacement);
            assert.equal(row.payoutsEnabled, false);
            assert.equal(row.transfersCapability, 'inactive');
        });

    } finally {
        process.env.STRIPE_MODE = originalMode;

        try {
            if (initialized) {
                await prisma.$transaction(async tx => {
                    await tx.stripeConnectedAccount.deleteMany({
                        where: { specialistId }
                    });

                    await tx.specialist.deleteMany({
                        where: { id: specialistId, userId }
                    });

                    await tx.user.deleteMany({
                        where: { id: userId }
                    });
                });

                await t.test('8 - Limpieza e inventario conservado', async () => {
                    assert.equal(
                        await prisma.user.count({
                            where: { id: userId }
                        }), 0
                    );

                    assert.equal(
                        await prisma.specialist.count({
                            where: { id: specialistId }
                        }), 0
                    );

                    assert.equal(
                        await prisma.stripeConnectedAccount.count({
                            where: { specialistId }
                        }), 0
                    );

                    assert.deepEqual(await inventory(), before);
                });
            }
        } finally {
            await prisma.$disconnect();
        }
    }
});
