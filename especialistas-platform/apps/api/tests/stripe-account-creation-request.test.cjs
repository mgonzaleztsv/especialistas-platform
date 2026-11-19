const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const {
    StripeAccountCreationRequestService
} = require('../dist/payments/stripe-account-creation-request.service.js');

test('Stripe: registro seguro de solicitudes', async (t) => {
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

    let specialist;
    let existing;
    let connected;
    let concurrent;
    let createFailure;
    let disableDuringLookup;
    let calls;
    let createdData;

    function existingRequest() {
        return {
            id: 'existing-request',
            specialistId,
            country: 'US',
            livemode: false,
            status: 'PENDING',
            idempotencyKey: 'existing-key'
        };
    }

    function reset() {
        process.env.STRIPE_MODE = 'test';

        specialist = { id: specialistId };
        existing = null;
        connected = null;
        concurrent = null;
        createFailure = null;
        disableDuringLookup = false;
        createdData = null;

        calls = {
            specialist: 0,
            lookup: 0,
            connected: 0,
            create: 0
        };
    }

    const prisma = {
        specialist: {
            async findUnique(query) {
                calls.specialist++;

                assert.deepEqual(query, {
                    where: { id: specialistId },
                    select: { id: true }
                });

                if (disableDuringLookup)
                    process.env.STRIPE_MODE = 'disabled';

                return specialist;
            }
        },

        stripeConnectedAccount: {
            async findUnique(query) {
                calls.connected++;

                assert.deepEqual(query, {
                    where: { specialistId },
                    select: { id: true }
                });

                return connected;
            }
        },

        stripeAccountCreationRequest: {
            async findUnique(query) {
                calls.lookup++;

                assert.deepEqual(query, {
                    where: { specialistId }
                });

                return calls.lookup === 1
                    ? existing
                    : concurrent;
            },

            async create(query) {
                calls.create++;
                createdData = query.data;

                if (createFailure)
                    throw createFailure;

                return {
                    ...query.data,
                    attemptCount: 0
                };
            }
        }
    };

    const service =
        new StripeAccountCreationRequestService(prisma);

    const register = () =>
        service.registerRequest(specialistId, 'US');

    async function expectStatus(operation, status) {
        await assert.rejects(operation, error => {
            assert.equal(error.getStatus(), status);
            return true;
        });
    }

    function noWrites() {
        assert.equal(calls.create, 0);
    }

    function uniqueViolation() {
        return Object.assign(
            new Error('SIMULATED_UNIQUE_VIOLATION'),
            { code: 'P2002' }
        );
    }

    try {
        await t.test('1 - Modos no autorizados', async () => {
            reset();

            for (const mode of [
                'disabled', 'live', 'production', ''
            ]) {
                process.env.STRIPE_MODE = mode;

                await expectStatus(register, 503);
            }

            assert.equal(calls.specialist, 0);
            noWrites();
        });

        await t.test('2 - Especialistas invalidos', async () => {
            reset();

            for (const id of [
                null, undefined, 123, '', ' ',
                ' invalid', 'invalid ',
                'a'.repeat(256)
            ]) {
                await expectStatus(
                    () => service.registerRequest(id, 'US'),
                    400
                );
            }

            assert.equal(calls.specialist, 0);
            noWrites();
        });

        await t.test('3 - Formatos de pais invalidos', async () => {
            reset();

            for (const country of [
                null, undefined, 123, '',
                'us', 'USA', '12', ' US', 'US '
            ]) {
                await expectStatus(
                    () => service.registerRequest(
                        specialistId, country
                    ),
                    400
                );
            }

            assert.equal(calls.specialist, 0);
            noWrites();
        });

        await t.test('4 - Especialista inexistente', async () => {
            reset();
            specialist = null;

            await expectStatus(register, 404);

            assert.equal(calls.lookup, 0);
            assert.equal(calls.connected, 0);
            noWrites();
        });

        await t.test('5 - Registro inicial correcto', async () => {
            reset();

            const result = await register();

            assert.equal(result.created, true);
            assert.equal(result.request.status, 'PENDING');
            assert.equal(result.request.livemode, false);
            assert.equal(result.request.country, 'US');
            assert.equal(result.request.specialistId, specialistId);
            assert.equal(result.request.attemptCount, 0);
            assert.equal(calls.create, 1);
        });

        await t.test('6 - Identificador y clave persistente', async () => {
            reset();

            await register();

            assert.match(
                createdData.id,
                /^[a-f0-9-]{36}$/
            );

            const canonical = JSON.stringify([
                'connectpro',
                'test',
                'v1',
                'connected-account-create',
                createdData.id
            ]);

            const digest = createHash('sha256')
                .update(canonical, 'utf8')
                .digest('hex');

            assert.deepEqual(createdData, {
                id: createdData.id,
                specialistId,
                country: 'US',
                livemode: false,
                status: 'PENDING',
                idempotencyKey:
                    'connectpro:test:v1:' +
                    'connected-account-create:' +
                    digest
            });
        });

        await t.test('7 - Recuperacion de solicitud existente', async () => {
            reset();
            existing = existingRequest();

            assert.deepEqual(await register(), {
                created: false,
                request: existing
            });

            noWrites();
        });

        await t.test('8 - Conservacion de clave anterior', async () => {
            reset();
            existing = existingRequest();

            const result = await register();

            assert.equal(
                result.request.idempotencyKey,
                'existing-key'
            );

            noWrites();
        });

        await t.test('9 - Estados existentes conservados', async () => {
            for (const status of [
                'PENDING',
                'PROCESSING',
                'SUCCEEDED',
                'FAILED',
                'UNCERTAIN'
            ]) {
                reset();

                existing = {
                    ...existingRequest(),
                    status
                };

                const result = await register();

                assert.equal(result.created, false);
                assert.equal(result.request.status, status);

                noWrites();
            }
        });

        await t.test('10 - Cambio de pais rechazado', async () => {
            reset();

            existing = {
                ...existingRequest(),
                country: 'ES'
            };

            await expectStatus(register, 409);
            noWrites();
        });

        await t.test('11 - Solicitud real rechazada', async () => {
            reset();

            existing = {
                ...existingRequest(),
                livemode: true
            };

            await expectStatus(register, 409);
            noWrites();
        });

        await t.test('12 - Cuenta previamente vinculada', async () => {
            reset();

            connected = { id: 'existing-account' };

            await expectStatus(register, 409);
            noWrites();
        });

        await t.test('13 - Solicitud completada recuperable', async () => {
            reset();

            existing = {
                ...existingRequest(),
                status: 'SUCCEEDED'
            };

            connected = { id: 'existing-account' };

            const result = await register();

            assert.equal(result.created, false);
            assert.equal(result.request.status, 'SUCCEEDED');

            noWrites();
        });

        await t.test('14 - Desactivacion durante consulta', async () => {
            reset();

            disableDuringLookup = true;

            await expectStatus(register, 503);
            noWrites();
        });

        await t.test('15 - Recuperacion de registro concurrente', async () => {
            reset();

            createFailure = uniqueViolation();
            concurrent = existingRequest();

            assert.deepEqual(await register(), {
                created: false,
                request: concurrent
            });

            assert.equal(calls.lookup, 2);
            assert.equal(calls.create, 1);
        });

        await t.test('16 - Conflicto concurrente de pais', async () => {
            reset();

            createFailure = uniqueViolation();

            concurrent = {
                ...existingRequest(),
                country: 'MX'
            };

            await expectStatus(register, 409);
        });

        await t.test('17 - Solicitud concurrente real', async () => {
            reset();

            createFailure = uniqueViolation();

            concurrent = {
                ...existingRequest(),
                livemode: true
            };

            await expectStatus(register, 409);
        });

        await t.test('18 - Unicidad sin solicitud recuperable', async () => {
            reset();

            createFailure = uniqueViolation();

            await assert.rejects(
                register,
                error => error === createFailure
            );

            assert.equal(calls.lookup, 2);
        });

        await t.test('19 - Error inesperado no ocultado', async () => {
            reset();

            createFailure = new Error(
                'SIMULATED_DATABASE_ERROR'
            );

            await assert.rejects(
                register,
                error => error === createFailure
            );

            assert.equal(calls.lookup, 1);
        });

    } finally {
        process.env.STRIPE_MODE = originalMode;
    }
});
