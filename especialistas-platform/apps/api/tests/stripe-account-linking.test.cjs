const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const {
    StripeAccountCreationRequestService
} = require('../dist/payments/stripe-account-creation-request.service.js');

const {
    buildStripeIdempotencyKey
} = require('../dist/payments/stripe-idempotency.js');

test('Stripe: vinculacion atomica de cuentas', async (t) => {
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
    const specialistId = randomUUID();
    const stripeAccountId = 'acct_Fictitious123';

    let request;
    let external;
    let updateCount;
    let transactionOptions;
    let updateQuery;
    let createQuery;
    let failure;
    let failureStage;
    let disableStage;
    let calls;

    function reset() {
        process.env.STRIPE_MODE = 'test';

        request = {
            id: requestId,
            specialistId,
            country: 'US',
            livemode: false,
            status: 'PROCESSING',
            processingToken,
            attemptCount: 1,
            stripeAccountId: null,
            idempotencyKey: buildStripeIdempotencyKey(
                'connected-account-create',
                requestId
            )
        };

        external = {
            stripeAccountId,
            country: 'US',
            livemode: false
        };

        updateCount = 1;
        transactionOptions = null;
        updateQuery = null;
        createQuery = null;
        failure = null;
        failureStage = null;
        disableStage = null;

        calls = {
            transaction: 0,
            lookup: 0,
            update: 0,
            create: 0
        };
    }

    function checkStage(stage) {
        if (disableStage === stage)
            process.env.STRIPE_MODE = 'disabled';

        if (failureStage === stage)
            throw failure;
    }

    const tx = {
        stripeAccountCreationRequest: {
            async findUnique(query) {
                calls.lookup++;

                assert.deepEqual(
                    query,
                    { where: { id: requestId } }
                );

                checkStage('lookup');

                return request;
            },

            async updateMany(query) {
                calls.update++;
                updateQuery = query;

                checkStage('update');

                return { count: updateCount };
            }
        },

        stripeConnectedAccount: {
            async create(query) {
                calls.create++;
                createQuery = query;

                checkStage('create');

                return {
                    id: randomUUID(),
                    ...query.data
                };
            }
        }
    };

    const prisma = {
        async $transaction(callback, options) {
            calls.transaction++;
            transactionOptions = options;

            checkStage('transaction');

            const result = await callback(tx);

            checkStage('commit');

            return result;
        }
    };

    const service =
        new StripeAccountCreationRequestService(prisma);

    function succeed() {
        return service.markSucceeded(
            requestId,
            processingToken,
            external
        );
    }

    async function expectStatus(operation, status) {
        await assert.rejects(operation, error => {
            assert.equal(error.getStatus(), status);
            return true;
        });
    }

    function noTransaction() {
        assert.equal(calls.transaction, 0);
        assert.equal(calls.update, 0);
        assert.equal(calls.create, 0);
    }

    function noWrites() {
        assert.equal(calls.update, 0);
        assert.equal(calls.create, 0);
    }

    try {
        await t.test('1 - Modos no autorizados', async () => {
            reset();

            for (const mode of [
                'disabled', 'live', 'production', ''
            ]) {
                process.env.STRIPE_MODE = mode;
                await expectStatus(succeed, 503);
            }

            noTransaction();
        });

        await t.test('2 - Identificador de solicitud invalido', async () => {
            reset();

            for (const id of [
                null, undefined, 123, '', 'invalid'
            ]) {
                await expectStatus(
                    () => service.markSucceeded(
                        id, processingToken, external
                    ),
                    400
                );
            }

            noTransaction();
        });

        await t.test('3 - Token de procesamiento invalido', async () => {
            reset();

            for (const token of [
                null, undefined, 123, '', 'invalid'
            ]) {
                await expectStatus(
                    () => service.markSucceeded(
                        requestId, token, external
                    ),
                    400
                );
            }

            noTransaction();
        });

        await t.test('4 - Respuesta externa inexistente', async () => {
            reset();

            for (const value of [
                null, undefined, 123, '', {}
            ]) {
                external = value;

                await expectStatus(succeed, 400);
            }

            noTransaction();
        });

        await t.test('5 - Identificador Stripe invalido', async () => {
            reset();

            for (const id of [
                null,
                123,
                '',
                'acct_',
                'cus_123',
                'acct_invalid-id',
                'acct_' + 'a'.repeat(256)
            ]) {
                external.stripeAccountId = id;

                await expectStatus(succeed, 400);
            }

            noTransaction();
        });

        await t.test('6 - Cuenta externa real rechazada', async () => {
            reset();

            for (const value of [
                true, null, undefined, 'false'
            ]) {
                external.livemode = value;

                await expectStatus(succeed, 400);
            }

            noTransaction();
        });

        await t.test('7 - Pais externo invalido', async () => {
            reset();

            for (const country of [
                null, '', 'us', 'USA', '12'
            ]) {
                external.country = country;

                await expectStatus(succeed, 400);
            }

            noTransaction();
        });

        await t.test('8 - Solicitud inexistente', async () => {
            reset();
            request = null;

            await expectStatus(succeed, 404);
            noWrites();
        });

        await t.test('9 - Solicitud real bloqueada', async () => {
            reset();
            request.livemode = true;

            await expectStatus(succeed, 409);
            noWrites();
        });

        await t.test('10 - Pais incompatible', async () => {
            reset();
            request.country = 'ES';

            await expectStatus(succeed, 409);
            noWrites();
        });

        await t.test('11 - Clave de idempotencia incompatible', async () => {
            reset();
            request.idempotencyKey = 'incorrect-key';

            await expectStatus(succeed, 409);
            noWrites();
        });

        await t.test('12 - Estados no autorizados', async () => {
            for (const status of [
                'PENDING',
                'FAILED',
                'UNCERTAIN',
                'SUCCEEDED'
            ]) {
                reset();
                request.status = status;

                await expectStatus(succeed, 409);
                noWrites();
            }
        });

        await t.test('13 - Token incorrecto rechazado', async () => {
            reset();
            request.processingToken = randomUUID();

            await expectStatus(succeed, 409);
            noWrites();
        });

        await t.test('14 - Cantidad de intentos incompatible', async () => {
            for (const count of [0, 2, -1]) {
                reset();
                request.attemptCount = count;

                await expectStatus(succeed, 409);
                noWrites();
            }
        });

        await t.test('15 - Identificador externo previo bloqueado', async () => {
            reset();
            request.stripeAccountId = 'acct_Previous123';

            await expectStatus(succeed, 409);
            noWrites();
        });

        await t.test('16 - Conflicto de actualizacion', async () => {
            reset();
            updateCount = 0;

            await expectStatus(succeed, 409);

            assert.equal(calls.update, 1);
            assert.equal(calls.create, 0);
        });

        await t.test('17 - Cantidad de actualizaciones inesperada', async () => {
            reset();
            updateCount = 2;

            await expectStatus(succeed, 409);

            assert.equal(calls.create, 0);
        });

        await t.test('18 - Vinculacion correcta', async () => {
            reset();

            const result = await succeed();

            assert.deepEqual(result, {
                transitioned: true,
                requestId,
                specialistId,
                stripeAccountId,
                status: 'SUCCEEDED',
                completedAt: updateQuery.data.completedAt
            });

            assert.ok(result.completedAt instanceof Date);

            assert.deepEqual(calls, {
                transaction: 1,
                lookup: 1,
                update: 1,
                create: 1
            });
        });

        await t.test('19 - Aislamiento Serializable', async () => {
            reset();

            await succeed();

            assert.deepEqual(transactionOptions, {
                isolationLevel: 'Serializable'
            });
        });

        await t.test('20 - Filtro atomico completo', async () => {
            reset();

            await succeed();

            const now = updateQuery.data.completedAt;

            assert.deepEqual(updateQuery.where, {
                id: requestId,
                specialistId,
                country: 'US',
                idempotencyKey: request.idempotencyKey,
                livemode: false,
                status: 'PROCESSING',
                processingToken,
                attemptCount: 1,
                stripeAccountId: null,
                completedAt: null,
                lastErrorCode: null,
                processingAt: { lte: now },
                firstAttemptAt: { lte: now },
                lastAttemptAt: { lte: now },
                specialist: {
                    is: {
                        stripeConnectedAccount: {
                            is: null
                        }
                    }
                }
            });
        });

        await t.test('21 - Transicion y revocacion del token', async () => {
            reset();

            const result = await succeed();

            assert.deepEqual(updateQuery.data, {
                status: 'SUCCEEDED',
                stripeAccountId,
                processingToken: null,
                processingAt: null,
                completedAt: result.completedAt,
                lastErrorCode: null
            });
        });

        await t.test('22 - Cuenta creada sin habilitacion financiera', async () => {
            reset();

            Object.assign(external, {
                detailsSubmitted: true,
                chargesEnabled: true,
                payoutsEnabled: true,
                transfersCapability: 'active',
                lastSyncedAt: new Date()
            });

            await succeed();

            assert.deepEqual(createQuery.data, {
                specialistId,
                stripeAccountId,
                country: 'US',
                livemode: false,
                detailsSubmitted: false,
                chargesEnabled: false,
                payoutsEnabled: false,
                transfersCapability: null,
                lastSyncedAt: null
            });
        });

        await t.test('23 - Conflicto de unicidad controlado', async () => {
            reset();

            failureStage = 'create';

            failure = Object.assign(
                new Error('SIMULATED_UNIQUE_VIOLATION'),
                { code: 'P2002' }
            );

            await expectStatus(succeed, 409);
        });

        await t.test('24 - Conflicto Serializable controlado', async () => {
            reset();

            failureStage = 'commit';

            failure = Object.assign(
                new Error('SIMULATED_SERIALIZATION_ERROR'),
                { code: 'P2034' }
            );

            await expectStatus(succeed, 409);
        });

        await t.test('25 - Error de persistencia no ocultado', async () => {
            reset();

            failureStage = 'create';
            failure = new Error('SIMULATED_DATABASE_ERROR');

            await assert.rejects(
                succeed,
                error => error === failure
            );
        });

        await t.test('26 - Desactivacion antes de escritura', async () => {
            reset();
            disableStage = 'lookup';

            await expectStatus(succeed, 503);
            noWrites();
        });

        await t.test('27 - Desactivacion antes de crear vinculacion', async () => {
            reset();
            disableStage = 'update';

            await expectStatus(succeed, 503);

            assert.equal(calls.update, 1);
            assert.equal(calls.create, 0);
        });

        await t.test('28 - Desactivacion antes de concluir transaccion', async () => {
            reset();
            disableStage = 'create';

            await expectStatus(succeed, 503);

            assert.equal(calls.create, 1);
        });

        await t.test('29 - Resultado sin token ni clave interna', async () => {
            reset();

            const result = await succeed();

            assert.equal(
                Object.hasOwn(result, 'processingToken'),
                false
            );

            assert.equal(
                Object.hasOwn(result, 'idempotencyKey'),
                false
            );

            assert.ok(
                !JSON.stringify(result).includes(processingToken)
            );
        });

    } finally {
        process.env.STRIPE_MODE = originalMode;
    }
});
