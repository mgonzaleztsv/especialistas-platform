const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const {
    StripeAccountCreationRequestService
} = require('../dist/payments/stripe-account-creation-request.service.js');

const {
    buildStripeIdempotencyKey
} = require('../dist/payments/stripe-idempotency.js');

test('Stripe: transiciones controladas', async (t) => {
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

    const requestId = randomUUID();
    const processingToken = randomUUID();

    let calls;
    let updateCount;
    let receivedQuery;
    let databaseFailure;

    function reset() {
        process.env.STRIPE_MODE = 'test';
        calls = 0;
        updateCount = 1;
        receivedQuery = null;
        databaseFailure = null;
    }

    const prisma = {
        stripeAccountCreationRequest: {
            async updateMany(query) {
                calls++;
                receivedQuery = query;

                if (databaseFailure)
                    throw databaseFailure;

                return { count: updateCount };
            }
        }
    };

    const service =
        new StripeAccountCreationRequestService(prisma);

    function fail(code = 'LOCAL_PRECONDITION_FAILED') {
        return service.markFailed(
            requestId,
            processingToken,
            code
        );
    }

    function uncertain(code = 'EXTERNAL_RESULT_UNKNOWN') {
        return service.markUncertain(
            requestId,
            processingToken,
            code
        );
    }

    async function expectStatus(operation, status) {
        await assert.rejects(operation, error => {
            assert.equal(error.getStatus(), status);
            return true;
        });
    }

    try {
        await t.test('1 - Modos no autorizados', async () => {
            reset();

            for (const mode of [
                'disabled', 'live', 'production', ''
            ]) {
                process.env.STRIPE_MODE = mode;

                await expectStatus(fail, 503);
                await expectStatus(uncertain, 503);
            }

            assert.equal(calls, 0);
        });

        await t.test('2 - Identificadores invalidos', async () => {
            reset();

            for (const id of [
                null, undefined, 123, '',
                'invalid-id', ' ' + requestId
            ]) {
                await expectStatus(
                    () => service.markFailed(
                        id,
                        processingToken,
                        'LOCAL_PRECONDITION_FAILED'
                    ),
                    400
                );
            }

            assert.equal(calls, 0);
        });

        await t.test('3 - Tokens invalidos', async () => {
            reset();

            for (const token of [
                null, undefined, 123, '',
                'invalid-token',
                processingToken + ' '
            ]) {
                await expectStatus(
                    () => service.markUncertain(
                        requestId,
                        token,
                        'EXTERNAL_TIMEOUT'
                    ),
                    400
                );
            }

            assert.equal(calls, 0);
        });

        await t.test('4 - Codigos definitivos permitidos', async () => {
            for (const code of [
                'LOCAL_PRECONDITION_FAILED',
                'EXTERNAL_REJECTION_CONFIRMED'
            ]) {
                reset();

                const result = await fail(code);

                assert.equal(result.status, 'FAILED');
                assert.equal(result.lastErrorCode, code);
                assert.equal(calls, 1);
            }
        });

        await t.test('5 - Codigos inciertos permitidos', async () => {
            for (const code of [
                'EXTERNAL_TIMEOUT',
                'EXTERNAL_CONNECTION_ERROR',
                'EXTERNAL_RESULT_UNKNOWN',
                'EXTERNAL_RESPONSE_INVALID',
                'LOCAL_PERSISTENCE_ERROR'
            ]) {
                reset();

                const result = await uncertain(code);

                assert.equal(result.status, 'UNCERTAIN');
                assert.equal(result.lastErrorCode, code);
                assert.equal(calls, 1);
            }
        });

        await t.test('6 - Error incierto no puede marcarse definitivo', async () => {
            reset();

            for (const code of [
                'EXTERNAL_TIMEOUT',
                'EXTERNAL_CONNECTION_ERROR',
                'EXTERNAL_RESULT_UNKNOWN',
                'LOCAL_PERSISTENCE_ERROR'
            ]) {
                await expectStatus(
                    () => fail(code),
                    400
                );
            }

            assert.equal(calls, 0);
        });

        await t.test('7 - Codigo definitivo no admitido como incierto', async () => {
            reset();

            await expectStatus(
                () => uncertain(
                    'EXTERNAL_REJECTION_CONFIRMED'
                ),
                400
            );

            assert.equal(calls, 0);
        });

        await t.test('8 - Mensajes externos no admitidos', async () => {
            reset();

            for (const code of [
                null,
                123,
                '',
                'UNKNOWN_ERROR',
                'PRIVATE_SIMULATED_EXTERNAL_MESSAGE'
            ]) {
                await expectStatus(
                    () => fail(code),
                    400
                );

                await expectStatus(
                    () => uncertain(code),
                    400
                );
            }

            assert.equal(calls, 0);
        });

        await t.test('9 - Conflicto de fallo definitivo', async () => {
            reset();
            updateCount = 0;

            await expectStatus(fail, 409);

            assert.equal(calls, 1);
        });

        await t.test('10 - Conflicto de resultado incierto', async () => {
            reset();
            updateCount = 0;

            await expectStatus(uncertain, 409);

            assert.equal(calls, 1);
        });

        await t.test('11 - Cantidad inesperada de escrituras', async () => {
            reset();
            updateCount = 2;

            await expectStatus(fail, 409);
        });

        await t.test('12 - Transicion FAILED correcta', async () => {
            reset();

            const before = Date.now();
            const result = await fail();
            const after = Date.now();

            assert.equal(result.transitioned, true);
            assert.equal(result.requestId, requestId);
            assert.equal(result.status, 'FAILED');

            assert.ok(result.completedAt instanceof Date);
            assert.ok(
                result.completedAt.getTime() >= before
            );
            assert.ok(
                result.completedAt.getTime() <= after
            );
        });

        await t.test('13 - Transicion UNCERTAIN correcta', async () => {
            reset();

            assert.deepEqual(await uncertain(), {
                transitioned: true,
                requestId,
                status: 'UNCERTAIN',
                lastErrorCode: 'EXTERNAL_RESULT_UNKNOWN',
                completedAt: null
            });
        });

        await t.test('14 - Filtro atomico completo', async () => {
            reset();

            await fail();

            const now = receivedQuery.data.completedAt;

            assert.deepEqual(receivedQuery.where, {
                id: requestId,

                idempotencyKey:
                    buildStripeIdempotencyKey(
                        'connected-account-create',
                        requestId
                    ),

                livemode: false,
                status: 'PROCESSING',
                processingToken,
                attemptCount: 1,
                stripeAccountId: null,
                processingAt: { lte: now },
                firstAttemptAt: { lte: now },
                lastAttemptAt: { lte: now },
                completedAt: null,
                lastErrorCode: null
            });
        });

        await t.test('15 - Token revocado al registrar fallo', async () => {
            reset();

            const result = await fail();

            assert.deepEqual(receivedQuery.data, {
                status: 'FAILED',
                processingToken: null,
                processingAt: null,
                completedAt: result.completedAt,
                lastErrorCode: 'LOCAL_PRECONDITION_FAILED'
            });
        });

        await t.test('16 - Token revocado ante incertidumbre', async () => {
            reset();

            await uncertain();

            assert.deepEqual(receivedQuery.data, {
                status: 'UNCERTAIN',
                processingToken: null,
                processingAt: null,
                completedAt: null,
                lastErrorCode: 'EXTERNAL_RESULT_UNKNOWN'
            });
        });

        await t.test('17 - Identidad e historial no modificados', async () => {
            reset();

            await uncertain();

            for (const field of [
                'id',
                'specialistId',
                'country',
                'livemode',
                'idempotencyKey',
                'stripeAccountId',
                'attemptCount',
                'firstAttemptAt',
                'lastAttemptAt',
                'createdAt'
            ]) {
                assert.equal(
                    Object.hasOwn(
                        receivedQuery.data,
                        field
                    ),
                    false
                );
            }
        });

        await t.test('18 - Token no expuesto en resultado', async () => {
            reset();

            const result = await fail();

            assert.equal(
                Object.hasOwn(
                    result,
                    'processingToken'
                ),
                false
            );

            assert.equal(
                JSON.stringify(result)
                    .includes(processingToken),
                false
            );
        });

        await t.test('19 - Error de almacenamiento no ocultado', async () => {
            reset();

            databaseFailure = new Error(
                'SIMULATED_DATABASE_ERROR'
            );

            await assert.rejects(
                uncertain,
                error => error === databaseFailure
            );
        });

        await t.test('20 - Desactivacion posterior respetada', async () => {
            reset();

            await fail();

            process.env.STRIPE_MODE = 'disabled';

            await expectStatus(uncertain, 503);

            assert.equal(calls, 1);
        });

    } finally {
        process.env.STRIPE_MODE = originalMode;
    }
});
