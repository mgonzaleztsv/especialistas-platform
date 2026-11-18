const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    StripeAccountReaderService
} = require('../dist/payments/stripe-account-reader.service.js');

test('Stripe: consulta segura de cuentas', async (t) => {
    assert.equal(process.env.NODE_ENV, 'test');
    assert.equal(process.env.STRIPE_MODE, 'disabled');
    assert.equal(process.env.INTERNAL_MVP_PAYMENTS_ENABLED, 'false');

    for (const key of Object.keys(process.env)) {
        if (key.toUpperCase().includes('STRIPE')) {
            assert.equal(key, 'STRIPE_MODE');
        }
    }

    const originalMode = process.env.STRIPE_MODE;
    const accountId = 'acct_Fictitious123';

    let response;
    let failure = null;
    let clientCalls = 0;
    let retrieveCalls = 0;
    let receivedId;

    const gateway = {
        getClient() {
            clientCalls++;

            return {
                accounts: {
                    async retrieve(id) {
                        retrieveCalls++;
                        receivedId = id;

                        if (failure)
                            throw failure;

                        return response;
                    }
                }
            };
        }
    };

    const service = new StripeAccountReaderService(gateway);

    function validAccount() {
        return {
            id: accountId,
            object: 'account',
            country: 'US',
            details_submitted: true,
            charges_enabled: false,
            payouts_enabled: true,
            capabilities: {
                transfers: 'active'
            }
        };
    }

    async function reject(operation, status, message) {
        await assert.rejects(operation, error => {
            assert.equal(error.getStatus(), status);

            if (message)
                assert.match(error.message, message);

            return true;
        });
    }

    async function invalidResponse(value, message) {
        process.env.STRIPE_MODE = 'test';
        failure = null;
        response = value;

        await reject(
            () => service.retrieveAccountSnapshot(accountId),
            502,
            message
        );
    }

    try {
        await t.test('1 - Modos no autorizados', async () => {
            const beforeClient = clientCalls;
            const beforeRetrieve = retrieveCalls;

            for (const mode of [
                'disabled', 'live', 'production', ''
            ]) {
                process.env.STRIPE_MODE = mode;

                await reject(
                    () => service.retrieveAccountSnapshot(accountId),
                    503
                );
            }

            assert.equal(clientCalls, beforeClient);
            assert.equal(retrieveCalls, beforeRetrieve);
        });

        await t.test('2 - Identificadores invalidos', async () => {
            process.env.STRIPE_MODE = 'test';

            const beforeClient = clientCalls;
            const beforeRetrieve = retrieveCalls;

            for (const id of [
                null,
                undefined,
                123,
                '',
                ' ',
                'acct_',
                'acct_invalid-id',
                'acct_invalid id',
                ' acct_123',
                'cus_123',
                'acct_' + 'a'.repeat(256)
            ]) {
                await reject(
                    () => service.retrieveAccountSnapshot(id),
                    400
                );
            }

            assert.equal(clientCalls, beforeClient);
            assert.equal(retrieveCalls, beforeRetrieve);
        });

        await t.test('3 - Respuesta inexistente', async () => {
            await invalidResponse(null, /incompatible/);
            await invalidResponse(undefined, /incompatible/);
        });

        await t.test('4 - Identidad incompatible', async () => {
            await invalidResponse({
                ...validAccount(),
                id: 'acct_Different123'
            }, /incompatible/);
        });

        await t.test('5 - Tipo de objeto incompatible', async () => {
            await invalidResponse({
                ...validAccount(),
                object: 'customer'
            }, /incompatible/);
        });

        await t.test('6 - Cuenta eliminada rechazada', async () => {
            await invalidResponse({
                ...validAccount(),
                deleted: true
            }, /eliminada/);
        });

        await t.test('7 - Cuenta real rechazada', async () => {
            await invalidResponse({
                ...validAccount(),
                livemode: true
            }, /entorno de pruebas/);
        });

        await t.test('8 - Pais invalido', async () => {
            for (const country of [
                null, undefined, '', 'us', 'USA', '12'
            ]) {
                await invalidResponse({
                    ...validAccount(),
                    country
                }, /inválido/);
            }
        });

        await t.test('9 - Indicadores financieros invalidos', async () => {
            for (const field of [
                'details_submitted',
                'charges_enabled',
                'payouts_enabled'
            ]) {
                for (const value of [
                    null, undefined, 'true', 1
                ]) {
                    await invalidResponse({
                        ...validAccount(),
                        [field]: value
                    }, /incompleto/);
                }
            }
        });

        await t.test('10 - Capacidad desconocida rechazada', async () => {
            for (const transfers of [
                'unknown', true, 123, ''
            ]) {
                await invalidResponse({
                    ...validAccount(),
                    capabilities: { transfers }
                }, /desconocida/);
            }
        });

        await t.test('11 - Capacidades reconocidas', async () => {
            process.env.STRIPE_MODE = 'test';
            failure = null;

            for (const transfers of [
                'active', 'inactive', 'pending', null
            ]) {
                response = {
                    ...validAccount(),
                    capabilities: { transfers }
                };

                const snapshot =
                    await service.retrieveAccountSnapshot(accountId);

                assert.equal(
                    snapshot.transfersCapability,
                    transfers
                );
            }
        });

        await t.test('12 - Capacidad ausente no habilitada', async () => {
            response = validAccount();
            delete response.capabilities;

            const snapshot =
                await service.retrieveAccountSnapshot(accountId);

            assert.equal(snapshot.transfersCapability, null);
        });

        await t.test('13 - Error externo sanitizado', async () => {
            failure = new Error('PRIVATE_SIMULATED_STRIPE_ERROR');

            try {
                await assert.rejects(
                    () => service.retrieveAccountSnapshot(accountId),
                    error => {
                        assert.equal(error.getStatus(), 502);

                        assert.match(
                            error.message,
                            /No fue posible consultar/
                        );

                        assert.ok(
                            !JSON.stringify(error.getResponse())
                            .includes('PRIVATE_SIMULATED_STRIPE_ERROR')
                        );

                        return true;
                    }
                );
            } finally {
                failure = null;
            }
        });

        await t.test('14 - Consulta correcta y datos limitados', async () => {
            response = {
                ...validAccount(),
                email: 'private@example.invalid',
                external_accounts: {
                    data: ['PRIVATE_BANK_DATA']
                },
                individual: {
                    first_name: 'PRIVATE_NAME'
                }
            };

            const before = Date.now();

            const snapshot =
                await service.retrieveAccountSnapshot(accountId);

            const after = Date.now();

            assert.equal(receivedId, accountId);

            assert.ok(snapshot.lastSyncedAt instanceof Date);
            assert.ok(snapshot.lastSyncedAt.getTime() >= before);
            assert.ok(snapshot.lastSyncedAt.getTime() <= after);

            assert.deepEqual(snapshot, {
                stripeAccountId: accountId,
                country: 'US',
                livemode: false,
                detailsSubmitted: true,
                chargesEnabled: false,
                payoutsEnabled: true,
                transfersCapability: 'active',
                lastSyncedAt: snapshot.lastSyncedAt
            });

            assert.equal(snapshot.email, undefined);
            assert.equal(snapshot.external_accounts, undefined);
            assert.equal(snapshot.individual, undefined);
        });

        await t.test('15 - Indicador de pruebas explicito', async () => {
            response = {
                ...validAccount(),
                livemode: false
            };

            const snapshot =
                await service.retrieveAccountSnapshot(accountId);

            assert.equal(snapshot.livemode, false);
        });

        await t.test('16 - Estado de entorno ambiguo rechazado', async () => {
            await invalidResponse({
                ...validAccount(),
                livemode: null
            }, /entorno de pruebas/);
        });

    } finally {
        process.env.STRIPE_MODE = originalMode;
    }
});
