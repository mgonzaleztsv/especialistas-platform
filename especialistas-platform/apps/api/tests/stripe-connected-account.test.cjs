const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    StripeConnectedAccountService
} = require('../dist/payments/stripe-connected-account.service.js');

test('Stripe Connect: seguridad y elegibilidad', async (t) => {
    assert.equal(process.env.NODE_ENV, 'test');
    assert.equal(process.env.STRIPE_MODE, 'disabled');
    assert.equal(process.env.INTERNAL_MVP_PAYMENTS_ENABLED, 'false');

    for (const key of Object.keys(process.env)) {
        if (key.toUpperCase().includes('STRIPE')) {
            assert.equal(key, 'STRIPE_MODE');
        }
    }

    const originalMode = process.env.STRIPE_MODE;

    let calls = 0;
    let result = null;
    let receivedQuery = null;

    const prisma = {
        stripeConnectedAccount: {
            findUnique: async (query) => {
                calls++;
                receivedQuery = query;
                return result;
            }
        }
    };

    const service = new StripeConnectedAccountService(prisma);

    const specialistId = 'specialist-fictitious-test';

    function mode(value) {
        process.env.STRIPE_MODE = value;
    }

    function validAccount() {
        return {
            id: 'account-local-test',
            specialistId,
            stripeAccountId: 'acct_fictitious_test',
            country: 'US',
            livemode: false,
            detailsSubmitted: true,
            chargesEnabled: false,
            payoutsEnabled: true,
            transfersCapability: 'active',
            lastSyncedAt: new Date()
        };
    }

    async function rejectedWithStatus(operation, status) {
        await assert.rejects(operation, error => {
            assert.equal(error.getStatus(), status);
            return true;
        });
    }

    async function expectIneligible(overrides, reasons) {
        mode('test');

        result = {
            ...validAccount(),
            ...overrides
        };

        const response =
            await service.getTransferReadiness(specialistId);

        assert.equal(response.eligible, false);
        assert.deepEqual(response.reasons, reasons);
    }

    try {
        await t.test('1 - Stripe desactivado', async () => {
            mode('disabled');
            const before = calls;

            await rejectedWithStatus(
                () => service.getTransferReadiness(specialistId),
                503
            );

            assert.equal(calls, before);
        });

        await t.test('2 - Modo real rechazado', async () => {
            const before = calls;

            for (const value of ['live', 'production']) {
                mode(value);

                await rejectedWithStatus(
                    () => service.getTransferReadiness(specialistId),
                    503
                );
            }

            assert.equal(calls, before);
        });

        await t.test('3 - Identificadores invalidos', async () => {
            mode('test');
            const before = calls;

            for (const value of [
                null,
                undefined,
                123,
                '',
                ' ',
                ' invalid',
                'invalid ',
                'a'.repeat(256)
            ]) {
                await rejectedWithStatus(
                    () => service.getTransferReadiness(value),
                    400
                );
            }

            assert.equal(calls, before);
        });

        await t.test('4 - Cuenta inexistente', async () => {
            mode('test');
            result = null;

            assert.deepEqual(
                await service.getTransferReadiness(specialistId),
                {
                    eligible: false,
                    reasons: ['ACCOUNT_NOT_FOUND']
                }
            );
        });

        await t.test('5 - Cuenta real rechazada', async () => {
            await expectIneligible(
                { livemode: true },
                ['LIVE_ACCOUNT_NOT_ALLOWED']
            );
        });

        await t.test('6 - Datos incompletos', async () => {
            await expectIneligible(
                { detailsSubmitted: false },
                ['DETAILS_NOT_SUBMITTED']
            );
        });

        await t.test('7 - Transferencias inactivas', async () => {
            for (const value of ['inactive', 'pending', null]) {
                await expectIneligible(
                    { transfersCapability: value },
                    ['TRANSFERS_NOT_ACTIVE']
                );
            }
        });

        await t.test('8 - Pagos bancarios deshabilitados', async () => {
            await expectIneligible(
                { payoutsEnabled: false },
                ['PAYOUTS_NOT_ENABLED']
            );
        });

        await t.test('9 - Sin sincronizacion', async () => {
            await expectIneligible(
                { lastSyncedAt: null },
                ['ACCOUNT_SYNC_REQUIRED']
            );
        });

        await t.test('10 - Sincronizacion vencida', async () => {
            await expectIneligible(
                {
                    lastSyncedAt: new Date(
                        Date.now() - 16 * 60 * 1000
                    )
                },
                ['ACCOUNT_SYNC_REQUIRED']
            );
        });

        await t.test('11 - Sincronizacion futura', async () => {
            await expectIneligible(
                {
                    lastSyncedAt: new Date(Date.now() + 60000)
                },
                ['ACCOUNT_SYNC_REQUIRED']
            );
        });

        await t.test('12 - Fecha de sincronizacion invalida', async () => {
            await expectIneligible(
                { lastSyncedAt: new Date(NaN) },
                ['ACCOUNT_SYNC_REQUIRED']
            );
        });

        await t.test('13 - Multiples impedimentos', async () => {
            await expectIneligible(
                {
                    livemode: true,
                    detailsSubmitted: false,
                    transfersCapability: 'inactive',
                    payoutsEnabled: false,
                    lastSyncedAt: null
                },
                [
                    'LIVE_ACCOUNT_NOT_ALLOWED',
                    'DETAILS_NOT_SUBMITTED',
                    'TRANSFERS_NOT_ACTIVE',
                    'PAYOUTS_NOT_ENABLED',
                    'ACCOUNT_SYNC_REQUIRED'
                ]
            );
        });

        await t.test('14 - Elegibilidad preliminar correcta', async () => {
            mode('test');
            result = validAccount();

            assert.deepEqual(
                await service.getTransferReadiness(specialistId),
                {
                    eligible: true,
                    reasons: []
                }
            );
        });

        await t.test('15 - Consulta limitada al especialista', async () => {
            mode('test');
            result = validAccount();

            assert.deepEqual(
                await service.findBySpecialistId(specialistId),
                result
            );

            assert.deepEqual(receivedQuery.where, {
                specialistId
            });

            assert.equal(receivedQuery.select.stripeAccountId, true);
            assert.equal(receivedQuery.select.lastSyncedAt, true);
            assert.equal(receivedQuery.select.specialist, undefined);
        });

        await t.test('16 - Error de almacenamiento no ocultado', async () => {
            mode('test');

            const failingService =
                new StripeConnectedAccountService({
                    stripeConnectedAccount: {
                        findUnique: async () => {
                            throw new Error('SIMULATED_DATABASE_ERROR');
                        }
                    }
                });

            await assert.rejects(
                () => failingService.getTransferReadiness(specialistId),
                /SIMULATED_DATABASE_ERROR/
            );
        });

    } finally {
        process.env.STRIPE_MODE = originalMode;
    }
});
