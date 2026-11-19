const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const {
    StripeAccountCreationRequestService
} = require('../dist/payments/stripe-account-creation-request.service.js');

const {
    buildStripeIdempotencyKey
} = require('../dist/payments/stripe-idempotency.js');

test('Stripe: procesamiento abandonado', async (t) => {
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

    const originalMode = process.env.STRIPE_MODE;

    const requestId = randomUUID();
    const specialistId = randomUUID();
    const processingToken = randomUUID();

    const fixedNow = Date.now();
    const RealDate = global.Date;

    let request;
    let lookupCalls;
    let writeCalls;
    let updateCount;
    let receivedQuery;
    let disableDuringLookup;
    let databaseFailure;

    function reset(ageMs = 31 * 60 * 1000) {
        process.env.STRIPE_MODE = 'test';

        const processingAt =
            new RealDate(fixedNow - ageMs);

        request = {
            id: requestId,
            specialistId,
            country: 'US',
            livemode: false,
            status: 'PROCESSING',
            attemptCount: 1,
            stripeAccountId: null,
            processingToken,
            processingAt,
            firstAttemptAt: processingAt,
            lastAttemptAt: processingAt,
            completedAt: null,
            lastErrorCode: null,
            idempotencyKey: buildStripeIdempotencyKey(
                'connected-account-create',
                requestId
            )
        };

        lookupCalls = 0;
        writeCalls = 0;
        updateCount = 1;
        receivedQuery = null;
        disableDuringLookup = false;
        databaseFailure = null;
    }

    const prisma = {
        stripeAccountCreationRequest: {
            async findUnique(query) {
                lookupCalls++;

                assert.deepEqual(
                    query,
                    { where: { id: requestId } }
                );

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

    function abandon() {
        return service.markAbandonedProcessing(
            requestId
        );
    }

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

                await expectStatus(abandon, 503);
            }

            assert.equal(lookupCalls, 0);
            noWrites();
        });

        await t.test('2 - Identificadores invalidos', async () => {
            reset();

            for (const id of [
                null, undefined, 123, '',
                'invalid-id', requestId + ' '
            ]) {
                await expectStatus(
                    () => service.markAbandonedProcessing(id),
                    400
                );
            }

            assert.equal(lookupCalls, 0);
            noWrites();
        });

        await t.test('3 - Solicitud inexistente', async () => {
            reset();
            request = null;

            await expectStatus(abandon, 404);
            noWrites();
        });

        await t.test('4 - Solicitud real bloqueada', async () => {
            reset();
            request.livemode = true;

            await expectStatus(abandon, 409);
            noWrites();
        });

        await t.test('5 - Estados no autorizados', async () => {
            for (const status of [
                'PENDING', 'FAILED',
                'SUCCEEDED', 'UNCERTAIN'
            ]) {
                reset();
                request.status = status;

                await expectStatus(abandon, 409);
                noWrites();
            }
        });

        await t.test('6 - Historial de intentos incompatible', async () => {
            for (const count of [0, 2, -1]) {
                reset();
                request.attemptCount = count;

                await expectStatus(abandon, 409);
                noWrites();
            }
        });

        await t.test('7 - Clave incompatible', async () => {
            reset();
            request.idempotencyKey = 'invalid-key';

            await expectStatus(abandon, 409);
            noWrites();
        });

        await t.test('8 - Cuenta externa ya registrada', async () => {
            reset();
            request.stripeAccountId = 'acct_Fictitious123';

            await expectStatus(abandon, 409);
            noWrites();
        });

        await t.test('9 - Resultado anterior bloqueado', async () => {
            reset();
            request.completedAt = new Date();

            await expectStatus(abandon, 409);
            noWrites();

            reset();
            request.lastErrorCode = 'EXTERNAL_TIMEOUT';

            await expectStatus(abandon, 409);
            noWrites();
        });

        await t.test('10 - Token inexistente o invalido', async () => {
            reset();
            request.processingToken = null;

            await expectStatus(abandon, 409);
            noWrites();

            reset();
            request.processingToken = 'invalid-token';

            await expectStatus(abandon, 400);
            noWrites();
        });

        await t.test('11 - Fechas ausentes bloqueadas', async () => {
            for (const field of [
                'processingAt',
                'firstAttemptAt',
                'lastAttemptAt'
            ]) {
                reset();
                request[field] = null;

                await expectStatus(abandon, 409);
                noWrites();
            }
        });

        await t.test('12 - Fechas invalidas bloqueadas', async () => {
            for (const value of [
                new Date(NaN),
                'invalid-date',
                123
            ]) {
                reset();
                request.processingAt = value;

                await expectStatus(abandon, 409);
                noWrites();
            }
        });

        await t.test('13 - Procesamiento reciente bloqueado', async () => {
            reset(10 * 60 * 1000);

            await expectStatus(abandon, 409);
            noWrites();
        });

        await t.test('14 - Fecha futura bloqueada', async () => {
            reset(-60 * 1000);

            await expectStatus(abandon, 409);
            noWrites();
        });

        await t.test('15 - Limite exacto de treinta minutos', async () => {
            const originalDate = global.Date;

            global.Date = class extends RealDate {
                constructor(...args) {
                    super(...(
                        args.length ? args : [fixedNow]
                    ));
                }

                static now() {
                    return fixedNow;
                }
            };

            try {
                reset(30 * 60 * 1000 - 1);

                // Crear fechas usando el reloj controlado.
                const recent = new Date(
                    fixedNow - 30 * 60 * 1000 + 1
                );

                request.processingAt = recent;
                request.firstAttemptAt = recent;
                request.lastAttemptAt = recent;

                await expectStatus(abandon, 409);
                noWrites();

                reset(30 * 60 * 1000);

                const boundary = new Date(
                    fixedNow - 30 * 60 * 1000
                );

                request.processingAt = boundary;
                request.firstAttemptAt = boundary;
                request.lastAttemptAt = boundary;

                const result = await abandon();

                assert.equal(result.status, 'UNCERTAIN');
                assert.equal(writeCalls, 1);

            } finally {
                global.Date = originalDate;
            }
        });

        await t.test('16 - Historial de fechas inconsistente', async () => {
            reset();

            request.firstAttemptAt = new Date(
                request.processingAt.getTime() - 1000
            );

            await expectStatus(abandon, 409);
            noWrites();
        });

        await t.test('17 - Desactivacion durante consulta', async () => {
            reset();
            disableDuringLookup = true;

            await expectStatus(abandon, 503);
            noWrites();
        });

        await t.test('18 - Conflicto concurrente', async () => {
            reset();
            updateCount = 0;

            await expectStatus(abandon, 409);

            assert.equal(writeCalls, 1);
        });

        await t.test('19 - Cantidad inesperada de escrituras', async () => {
            reset();
            updateCount = 2;

            await expectStatus(abandon, 409);
        });

        await t.test('20 - Recuperacion correcta', async () => {
            reset();

            assert.deepEqual(await abandon(), {
                transitioned: true,
                requestId,
                status: 'UNCERTAIN',
                lastErrorCode: 'LOCAL_PROCESSING_ABANDONED',
                completedAt: null
            });

            assert.equal(lookupCalls, 1);
            assert.equal(writeCalls, 1);
        });

        await t.test('21 - Filtro atomico completo', async () => {
            reset();

            await abandon();

            assert.deepEqual(receivedQuery.where, {
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
                processingAt: request.processingAt,
                firstAttemptAt: request.firstAttemptAt,
                lastAttemptAt: request.lastAttemptAt,
                specialist: {
                    is: {
                        stripeConnectedAccount: {
                            is: null
                        }
                    }
                }
            });
        });

        await t.test('22 - Token invalidado sin reiniciar solicitud', async () => {
            reset();

            await abandon();

            assert.deepEqual(receivedQuery.data, {
                status: 'UNCERTAIN',
                processingToken: null,
                processingAt: null,
                completedAt: null,
                lastErrorCode: 'LOCAL_PROCESSING_ABANDONED'
            });
        });

        await t.test('23 - Identidad e historial conservados', async () => {
            reset();

            await abandon();

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

        await t.test('24 - Resultado sin credenciales internas', async () => {
            reset();

            const result = await abandon();

            assert.equal(
                Object.hasOwn(result, 'processingToken'),
                false
            );

            assert.equal(
                Object.hasOwn(result, 'idempotencyKey'),
                false
            );

            assert.ok(
                !JSON.stringify(result)
                    .includes(processingToken)
            );
        });

        await t.test('25 - Error de persistencia no ocultado', async () => {
            reset();

            databaseFailure =
                new Error('SIMULATED_DATABASE_ERROR');

            await assert.rejects(
                abandon,
                error => error === databaseFailure
            );
        });

    } finally {
        global.Date = RealDate;
        process.env.STRIPE_MODE = originalMode;
    }
});
