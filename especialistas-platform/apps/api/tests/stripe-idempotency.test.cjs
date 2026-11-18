const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');

const {
    buildStripeIdempotencyKey
} = require('../dist/payments/stripe-idempotency.js');

test('Stripe: seguridad e idempotencia', async (t) => {
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

    const operation = 'connected-account-create';
    const operationId = 'fictitious-operation-123';

    function build(id = operationId) {
        return buildStripeIdempotencyKey(operation, id);
    }

    try {
        await t.test('1 - Modos no autorizados', () => {
            for (const mode of [
                'disabled', 'live', 'production', ''
            ]) {
                process.env.STRIPE_MODE = mode;

                assert.throws(
                    () => build(),
                    /modo de pruebas/
                );
            }

            delete process.env.STRIPE_MODE;

            assert.throws(
                () => build(),
                /modo de pruebas/
            );
        });

        process.env.STRIPE_MODE = 'test';

        await t.test('2 - Operaciones no autorizadas', () => {
            for (const value of [
                null,
                undefined,
                '',
                'payment-create',
                'transfer-create',
                'refund-create',
                'connected-account-delete'
            ]) {
                assert.throws(
                    () => buildStripeIdempotencyKey(
                        value, operationId
                    ),
                    /no autorizada/
                );
            }
        });

        await t.test('3 - Identificadores invalidos', () => {
            for (const value of [
                null,
                undefined,
                123,
                {},
                [],
                '',
                ' ',
                ' invalid',
                'invalid ',
                'invalid id',
                'invalid/id',
                'invalid:id',
                'invalid\nid',
                'a'.repeat(256)
            ]) {
                assert.throws(
                    () => buildStripeIdempotencyKey(
                        operation, value
                    ),
                    /inválido/
                );
            }
        });

        await t.test('4 - Generacion determinista', () => {
            const first = build();

            for (let i = 0; i < 100; i++) {
                assert.equal(build(), first);
            }
        });

        await t.test('5 - Identificadores diferentes', () => {
            assert.notEqual(
                build('operation-1'),
                build('operation-2')
            );

            assert.notEqual(
                build('Operation-1'),
                build('operation-1')
            );
        });

        await t.test('6 - Formato y version correctos', () => {
            const key = build();

            assert.match(
                key,
                /^connectpro:test:v1:connected-account-create:[a-f0-9]{64}$/
            );

            assert.ok(key.length <= 255);
        });

        await t.test('7 - Hash canonico reproducible', () => {
            const canonical = JSON.stringify([
                'connectpro',
                'test',
                'v1',
                operation,
                operationId
            ]);

            const digest = createHash('sha256')
                .update(canonical, 'utf8')
                .digest('hex');

            assert.equal(
                build(),
                'connectpro:test:v1:' +
                operation + ':' + digest
            );
        });

        await t.test('8 - Identificador no expuesto directamente', () => {
            assert.equal(
                build().includes(operationId),
                false
            );
        });

        await t.test('9 - Limites de identificador', () => {
            for (const id of [
                'a',
                'a'.repeat(255),
                'abc_DEF-123',
                randomUUID()
            ]) {
                assert.match(
                    build(id),
                    /:[a-f0-9]{64}$/
                );
            }
        });

        await t.test('10 - Mil operaciones independientes', () => {
            const keys = new Set();

            for (let i = 0; i < 1000; i++) {
                keys.add(build('operation-' + i));
            }

            assert.equal(keys.size, 1000);
        });

        await t.test('11 - Reintentos concurrentes', async () => {
            const keys = await Promise.all(
                Array.from(
                    { length: 100 },
                    async () => build()
                )
            );

            assert.equal(new Set(keys).size, 1);
        });

        await t.test('12 - Desactivacion posterior respetada', () => {
            const first = build();

            process.env.STRIPE_MODE = 'disabled';

            assert.throws(
                () => build(),
                /modo de pruebas/
            );

            process.env.STRIPE_MODE = 'test';

            assert.equal(build(), first);
        });

    } finally {
        process.env.STRIPE_MODE = originalMode;
    }
});
