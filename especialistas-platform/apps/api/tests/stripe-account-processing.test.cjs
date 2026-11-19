const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    StripeAccountCreationRequestService
} = require('../dist/payments/stripe-account-creation-request.service.js');

const {
    buildStripeIdempotencyKey
} = require('../dist/payments/stripe-idempotency.js');

test('Stripe: adquisicion exclusiva de procesamiento', async (t) => {
    assert.equal(process.env.NODE_ENV, 'test');
    assert.equal(process.env.STRIPE_MODE, 'disabled');
    assert.equal(
        process.env.INTERNAL_MVP_PAYMENTS_ENABLED,
        'false'
    );

    for (const key of Object.keys(process.env)) {
        if (key.toUpperCase().includes('STRIPE')) {
            assert.equal(key, 'STRIPE_MODE');
        }
    }

    const originalMode = process.env.STRIPE_MODE;

    const specialistId = 'specialist-fictitious';
    const requestId = 'request-fictitious';

    let request;
    let updateCount;
    let lookupCalls;
    let writeCalls;
    let receivedQuery;
    let disableDuringLookup;
    let databaseFailure;

    function reset() {
        process.env.STRIPE_MODE = 'test';

        request = {
            id: requestId,
            specialistId,
            country: 'US',
            livemode: false,
            status: 'PENDING',
            attemptCount: 0,
            stripeAccountId: null,
            processingToken: null,
            processingAt: null,
            firstAttemptAt: null,
            lastAttemptAt: null,
            completedAt: null,
            lastErrorCode: null,
            idempotencyKey: buildStripeIdempotencyKey(
                'connected-account-create',
                requestId
            )
        };

        updateCount = 1;
        lookupCalls = 0;
        writeCalls = 0;
        receivedQuery = null;
        disableDuringLookup = false;
        databaseFailure = null;
    }

    const prisma = {
        stripeAccountCreationRequest: {
            async findUnique(query) {
                lookupCalls++;

                assert.deepEqual(query, {
                    where: { specialistId }
                });

                if (disableDuringLookup)
                    process.env.STRIPE_MODE = 'disabled';

                return request;
            },

            async updateMany(query) {
                writeCalls++;
                receivedQuery = query;

                if (databaseFailure)
                    throw databaseFailure;

                return { count: updateCount };
            }
        }
    };

    const service =
        new StripeAccountCreationRequestService(prisma);

    const acquire = () =>
        service.acquireProcessing(specialistId);

    async function expectStatus(operation, status) {
        await assert.rejects(operation, error => {
            assert.equal(error.getStatus(), status);
            return true;
        });
    }

    function noWrites() {
        assert.equal(writeCalls, 0);
    }

    try {
        await t.test('1 - Modos no autorizados', async () => {
            reset();

            for (const mode of [
                'disabled', 'live', 'production', ''
            ]) {
                process.env.STRIPE_MODE = mode;
                await expectStatus(acquire, 503);
            }

            assert.equal(lookupCalls, 0);
            noWrites();
        });

        await t.test('2 - Especialistas invalidos', async () => {
            reset();

            for (const id of [
                null, undefined, 123, '',
                ' ', ' invalid', 'invalid ',
                'a'.repeat(256)
            ]) {
                await expectStatus(
                    () => service.acquireProcessing(id),
                    400
                );
            }

            assert.equal(lookupCalls, 0);
            noWrites();
        });

        await t.test('3 - Solicitud inexistente', async () => {
            reset();
            request = null;

            await expectStatus(acquire, 404);
            noWrites();
        });

        await t.test('4 - Solicitud real rechazada', async () => {
            reset();
            request.livemode = true;

            await expectStatus(acquire, 409);
            noWrites();
        });

        await t.test('5 - Estados no autorizados', async () => {
            for (const status of [
                'PROCESSING',
                'SUCCEEDED',
                'FAILED',
                'UNCERTAIN'
            ]) {
                reset();
                request.status = status;

                await expectStatus(acquire, 409);
                noWrites();
            }
        });

        await t.test('6 - Intentos anteriores bloqueados', async () => {
            for (const count of [1, 2, -1]) {
                reset();
                request.attemptCount = count;

                await expectStatus(acquire, 409);
                noWrites();
            }
        });

        await t.test('7 - Identificador Stripe previo bloqueado', async () => {
            reset();
            request.stripeAccountId = 'acct_Fictitious123';

            await expectStatus(acquire, 409);
            noWrites();
        });

        await t.test('8 - Token previo bloqueado', async () => {
            reset();
            request.processingToken = 'previous-token';

            await expectStatus(acquire, 409);
            noWrites();
        });

        await t.test('9 - Fechas previas bloqueadas', async () => {
            for (const field of [
                'processingAt',
                'firstAttemptAt',
                'lastAttemptAt',
                'completedAt'
            ]) {
                reset();
                request[field] = new Date();

                await expectStatus(acquire, 409);
                noWrites();
            }
        });

        await t.test('10 - Error anterior bloqueado', async () => {
            reset();
            request.lastErrorCode = 'PREVIOUS_ERROR';

            await expectStatus(acquire, 409);
            noWrites();
        });

        await t.test('11 - Pais invalido bloqueado', async () => {
            reset();
            request.country = 'USA';

            await expectStatus(acquire, 400);
            noWrites();
        });

        await t.test('12 - Clave incompatible bloqueada', async () => {
            reset();
            request.idempotencyKey = 'incorrect-key';

            await expectStatus(acquire, 409);
            noWrites();
        });

        await t.test('13 - Desactivacion durante consulta', async () => {
            reset();
            disableDuringLookup = true;

            await expectStatus(acquire, 503);
            noWrites();
        });

        await t.test('14 - Conflicto de actualizacion', async () => {
            reset();
            updateCount = 0;

            await expectStatus(acquire, 409);

            assert.equal(writeCalls, 1);
        });

        await t.test('15 - Cantidad inesperada de escrituras', async () => {
            reset();
            updateCount = 2;

            await expectStatus(acquire, 409);
        });

        await t.test('16 - Adquisicion correcta', async () => {
            reset();

            const before = Date.now();
            const result = await acquire();
            const after = Date.now();

            assert.equal(result.acquired, true);
            assert.equal(result.requestId, requestId);
            assert.equal(result.specialistId, specialistId);
            assert.equal(result.country, 'US');
            assert.equal(result.attemptCount, 1);

            assert.equal(
                result.idempotencyKey,
                request.idempotencyKey
            );

            assert.match(
                result.processingToken,
                /^[a-f0-9-]{36}$/
            );

            assert.ok(result.processingAt instanceof Date);
            assert.ok(
                result.processingAt.getTime() >= before
            );
            assert.ok(
                result.processingAt.getTime() <= after
            );

            assert.equal(lookupCalls, 1);
            assert.equal(writeCalls, 1);
        });

        await t.test('17 - Filtro atomico completo', async () => {
            reset();

            await acquire();

            assert.deepEqual(receivedQuery.where, {
                id: requestId,
                specialistId,
                country: 'US',
                idempotencyKey: request.idempotencyKey,
                livemode: false,
                status: 'PENDING',
                attemptCount: 0,
                stripeAccountId: null,
                processingToken: null,
                processingAt: null,
                firstAttemptAt: null,
                lastAttemptAt: null,
                completedAt: null,
                lastErrorCode: null,
                specialist: {
                    is: {
                        stripeConnectedAccount: {
                            is: null
                        }
                    }
                }
            });
        });

        await t.test('18 - Transicion limitada y fechas coherentes', async () => {
            reset();

            const result = await acquire();

            assert.deepEqual(receivedQuery.data, {
                status: 'PROCESSING',
                processingToken: result.processingToken,
                processingAt: result.processingAt,
                firstAttemptAt: result.processingAt,
                lastAttemptAt: result.processingAt,
                attemptCount: {
                    increment: 1
                }
            });
        });

        await t.test('19 - Tokens independientes', async () => {
            const tokens = new Set();

            for (let i = 0; i < 100; i++) {
                reset();

                const result = await acquire();
                tokens.add(result.processingToken);
            }

            assert.equal(tokens.size, 100);
        });

        await t.test('20 - Error de almacenamiento no ocultado', async () => {
            reset();

            databaseFailure = new Error(
                'SIMULATED_DATABASE_ERROR'
            );

            await assert.rejects(
                acquire,
                error => error === databaseFailure
            );
        });

    } finally {
        process.env.STRIPE_MODE = originalMode;
    }
});
