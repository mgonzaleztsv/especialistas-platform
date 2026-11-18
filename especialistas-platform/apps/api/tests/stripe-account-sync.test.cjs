const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    StripeAccountSyncService
} = require('../dist/payments/stripe-account-sync.service.js');

test('Stripe Connect: sincronizacion segura', async (t) => {
    assert.equal(process.env.NODE_ENV, 'test');
    assert.equal(process.env.STRIPE_MODE, 'disabled');
    assert.equal(process.env.INTERNAL_MVP_PAYMENTS_ENABLED, 'false');

    for (const key of Object.keys(process.env)) {
        if (key.toUpperCase().includes('STRIPE')) {
            assert.equal(key, 'STRIPE_MODE');
        }
    }

    const originalMode = process.env.STRIPE_MODE;

    const specialistId = 'specialist-fictitious';
    const stripeAccountId = 'acct_Fictitious123';

    function validAccount() {
        return {
            id: 'local-account-id',
            specialistId,
            stripeAccountId,
            country: 'US',
            livemode: false
        };
    }

    function validSnapshot() {
        return {
            stripeAccountId,
            country: 'US',
            livemode: false,
            detailsSubmitted: true,
            chargesEnabled: false,
            payoutsEnabled: true,
            transfersCapability: 'active',
            lastSyncedAt: new Date()
        };
    }

    let account;
    let snapshot;
    let updateCount;
    let lookupCalls;
    let readerCalls;
    let writeCalls;
    let receivedQuery;
    let readerFailure;
    let writeFailure;
    let disableDuringRead;

    function reset() {
        process.env.STRIPE_MODE = 'test';
        account = validAccount();
        snapshot = validSnapshot();
        updateCount = 1;
        lookupCalls = 0;
        readerCalls = 0;
        writeCalls = 0;
        receivedQuery = null;
        readerFailure = null;
        writeFailure = null;
        disableDuringRead = false;
    }

    const accounts = {
        async findBySpecialistId(id) {
            lookupCalls++;
            assert.equal(id, specialistId);
            return account;
        }
    };

    const reader = {
        async retrieveAccountSnapshot(id) {
            readerCalls++;
            assert.equal(id, stripeAccountId);

            if (readerFailure)
                throw readerFailure;

            if (disableDuringRead)
                process.env.STRIPE_MODE = 'disabled';

            return snapshot;
        }
    };

    const prisma = {
        stripeConnectedAccount: {
            async updateMany(query) {
                writeCalls++;
                receivedQuery = query;

                if (writeFailure)
                    throw writeFailure;

                return { count: updateCount };
            }
        }
    };

    const service = new StripeAccountSyncService(
        prisma, accounts, reader
    );

    const sync = () =>
        service.syncBySpecialistId(specialistId);

    async function expectStatus(status) {
        await assert.rejects(sync, error => {
            assert.equal(error.getStatus(), status);
            return true;
        });
    }

    try {
        await t.test('1 - Modos no autorizados', async () => {
            reset();

            for (const mode of ['disabled', 'live', 'production']) {
                process.env.STRIPE_MODE = mode;
                await expectStatus(503);
            }

            assert.equal(lookupCalls, 0);
            assert.equal(readerCalls, 0);
            assert.equal(writeCalls, 0);
        });

        await t.test('2 - Cuenta inexistente', async () => {
            reset();
            account = null;

            await expectStatus(404);

            assert.equal(readerCalls, 0);
            assert.equal(writeCalls, 0);
        });

        await t.test('3 - Cuenta real rechazada', async () => {
            reset();
            account.livemode = true;

            await expectStatus(409);

            assert.equal(readerCalls, 0);
            assert.equal(writeCalls, 0);
        });

        await t.test('4 - Identificador externo diferente', async () => {
            reset();
            snapshot.stripeAccountId = 'acct_Different123';

            await expectStatus(502);
            assert.equal(writeCalls, 0);
        });

        await t.test('5 - Pais diferente', async () => {
            reset();
            snapshot.country = 'ES';

            await expectStatus(502);
            assert.equal(writeCalls, 0);
        });

        await t.test('6 - Respuesta de entorno real', async () => {
            reset();
            snapshot.livemode = true;

            await expectStatus(502);
            assert.equal(writeCalls, 0);
        });

        await t.test('7 - Fecha inexistente o invalida', async () => {
            for (const value of [
                null,
                undefined,
                '2026-01-01',
                new Date(NaN)
            ]) {
                reset();
                snapshot.lastSyncedAt = value;

                await expectStatus(502);
                assert.equal(writeCalls, 0);
            }
        });

        await t.test('8 - Fecha futura rechazada', async () => {
            reset();

            snapshot.lastSyncedAt =
                new Date(Date.now() + 60000);

            await expectStatus(502);
            assert.equal(writeCalls, 0);
        });

        await t.test('9 - Observacion vencida', async () => {
            reset();

            snapshot.lastSyncedAt =
                new Date(Date.now() - 16 * 60 * 1000);

            await expectStatus(502);
            assert.equal(writeCalls, 0);
        });

        await t.test('10 - Desactivacion durante consulta', async () => {
            reset();
            disableDuringRead = true;

            await expectStatus(503);

            assert.equal(readerCalls, 1);
            assert.equal(writeCalls, 0);
        });

        await t.test('11 - Error externo sin escritura', async () => {
            reset();

            readerFailure = new Error(
                'SIMULATED_READER_ERROR'
            );

            await assert.rejects(
                sync,
                error => error === readerFailure
            );

            assert.equal(writeCalls, 0);
        });

        await t.test('12 - Conflicto de actualizacion', async () => {
            reset();
            updateCount = 0;

            await expectStatus(409);

            assert.equal(writeCalls, 1);
        });

        await t.test('13 - Cantidad de escrituras inesperada', async () => {
            reset();
            updateCount = 2;

            await expectStatus(409);
        });

        await t.test('14 - Sincronizacion correcta', async () => {
            reset();

            assert.deepEqual(await sync(), {
                synchronized: true,
                specialistId,
                lastSyncedAt: snapshot.lastSyncedAt
            });

            assert.equal(lookupCalls, 1);
            assert.equal(readerCalls, 1);
            assert.equal(writeCalls, 1);
        });

        await t.test('15 - Filtro atomico de identidad y fecha', async () => {
            reset();

            await sync();

            assert.deepEqual(receivedQuery.where, {
                id: account.id,
                specialistId,
                stripeAccountId,
                country: 'US',
                livemode: false,
                OR: [
                    { lastSyncedAt: null },
                    {
                        lastSyncedAt: {
                            lt: snapshot.lastSyncedAt
                        }
                    }
                ]
            });
        });

        await t.test('16 - Escritura limitada a indicadores', async () => {
            reset();

            await sync();

            assert.deepEqual(receivedQuery.data, {
                detailsSubmitted: true,
                chargesEnabled: false,
                payoutsEnabled: true,
                transfersCapability: 'active',
                lastSyncedAt: snapshot.lastSyncedAt
            });

            for (const field of [
                'id',
                'specialistId',
                'stripeAccountId',
                'country',
                'livemode'
            ]) {
                assert.equal(
                    Object.hasOwn(receivedQuery.data, field),
                    false
                );
            }
        });

        await t.test('17 - Revocacion de habilitaciones', async () => {
            reset();

            Object.assign(snapshot, {
                detailsSubmitted: false,
                chargesEnabled: false,
                payoutsEnabled: false,
                transfersCapability: 'inactive'
            });

            await sync();

            assert.equal(
                receivedQuery.data.detailsSubmitted,
                false
            );

            assert.equal(
                receivedQuery.data.payoutsEnabled,
                false
            );

            assert.equal(
                receivedQuery.data.transfersCapability,
                'inactive'
            );
        });

        await t.test('18 - Error de almacenamiento no ocultado', async () => {
            reset();

            writeFailure = new Error(
                'SIMULATED_DATABASE_ERROR'
            );

            await assert.rejects(
                sync,
                error => error === writeFailure
            );
        });

    } finally {
        process.env.STRIPE_MODE = originalMode;
    }
});
