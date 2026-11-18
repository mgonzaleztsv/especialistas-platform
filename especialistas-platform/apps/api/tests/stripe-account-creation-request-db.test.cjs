const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('Stripe: restricciones de solicitudes de alta', async (t) => {
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

    const db = new URL(process.env.DATABASE_URL);

    assert.ok(['postgres:', 'postgresql:'].includes(db.protocol));
    assert.ok(['localhost', '127.0.0.1'].includes(db.hostname));
    assert.equal(db.port, '5433');
    assert.equal(db.pathname, '/connectpro_test');
    assert.equal(db.username, 'connectpro_test');
    assert.equal(db.search, '?schema=public');
    assert.equal(db.hash, '');

    const { Client } = require('pg');

    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 5000
    });

    const userA = randomUUID();
    const userB = randomUUID();
    const specialistA = randomUUID();
    const specialistB = randomUUID();

    const requestA = randomUUID();
    const requestB = randomUUID();

    const keyA = 'test-key-' + randomUUID();
    const keyB = 'test-key-' + randomUUID();

    const accountId =
        'acct_Fictitious' +
        randomUUID().replace(/-/g, '');

    const token = randomUUID();

    let transaction = false;
    let sequence = 0;

    async function inventory() {
        const result = await client.query(`
            SELECT
                (SELECT COUNT(*)::int FROM public."User")
                    AS users,
                (SELECT COUNT(*)::int FROM public."Specialist")
                    AS specialists,
                (SELECT COUNT(*)::int FROM public."StripeConnectedAccount")
                    AS accounts,
                (SELECT COUNT(*)::int FROM public."StripeAccountCreationRequest")
                    AS requests,
                (SELECT COUNT(*)::int FROM public."Payment")
                    AS payments,
                (SELECT COUNT(*)::int FROM public."PaymentMovement")
                    AS movements
        `);

        return result.rows[0];
    }

    async function insertRequest(id, specialist, key) {
        return client.query(`
            INSERT INTO public."StripeAccountCreationRequest"
                ("id", "specialistId", "idempotencyKey",
                 "country", "updatedAt")
            VALUES ($1, $2, $3, 'US', CURRENT_TIMESTAMP)
            RETURNING *
        `, [id, specialist, key]);
    }

    async function expectViolation(operation, code, constraint) {
        const savepoint = 'test_sp_' + (++sequence);

        await client.query('SAVEPOINT ' + savepoint);

        try {
            await assert.rejects(operation, error => {
                assert.equal(error.code, code);

                if (constraint)
                    assert.equal(error.constraint, constraint);

                return true;
            });
        } finally {
            await client.query(
                'ROLLBACK TO SAVEPOINT ' + savepoint
            );

            await client.query(
                'RELEASE SAVEPOINT ' + savepoint
            );
        }
    }

    await client.connect();

    try {
        const identity = await client.query(`
            SELECT current_database() AS db,
                   current_user AS usr,
                   current_schema() AS schema
        `);

        assert.deepEqual(identity.rows[0], {
            db: 'connectpro_test',
            usr: 'connectpro_test',
            schema: 'public'
        });

        const before = await inventory();

        await client.query('BEGIN');
        transaction = true;

        for (const [user, specialist] of [
            [userA, specialistA],
            [userB, specialistB]
        ]) {
            await client.query(`
                INSERT INTO public."User"
                    ("id", "name", "email",
                     "passwordHash", "role",
                     "createdAt", "updatedAt")
                VALUES (
                    $1, 'Temporary Stripe request test',
                    $2, 'INVALID_TEST_HASH',
                    'SPECIALIST',
                    CURRENT_TIMESTAMP,
                    CURRENT_TIMESTAMP
                )
            `, [user, user + '@example.invalid']);

            await client.query(`
                INSERT INTO public."Specialist"
                    ("id", "userId", "createdAt", "updatedAt")
                VALUES (
                    $1, $2,
                    CURRENT_TIMESTAMP,
                    CURRENT_TIMESTAMP
                )
            `, [specialist, user]);
        }

        await t.test('1 - Valores iniciales seguros', async () => {
            const result = await insertRequest(
                requestA, specialistA, keyA
            );

            const row = result.rows[0];

            assert.equal(row.status, 'PENDING');
            assert.equal(row.livemode, false);
            assert.equal(row.attemptCount, 0);
            assert.equal(row.stripeAccountId, null);
            assert.equal(row.processingToken, null);
            assert.equal(row.processingAt, null);
            assert.equal(row.firstAttemptAt, null);
            assert.equal(row.lastAttemptAt, null);
            assert.equal(row.completedAt, null);
            assert.equal(row.lastErrorCode, null);
            assert.ok(row.createdAt);
        });

        await t.test('2 - Solicitud duplicada rechazada', async () => {
            await expectViolation(
                () => insertRequest(
                    randomUUID(),
                    specialistA,
                    'other-' + randomUUID()
                ),
                '23505',
                'StripeAccountCreationRequest_specialistId_key'
            );
        });

        await t.test('3 - Clave de idempotencia duplicada', async () => {
            await expectViolation(
                () => insertRequest(
                    requestB, specialistB, keyA
                ),
                '23505',
                'StripeAccountCreationRequest_idempotencyKey_key'
            );
        });

        await t.test('4 - Especialista inexistente', async () => {
            await expectViolation(
                () => insertRequest(
                    randomUUID(),
                    randomUUID(),
                    'invalid-' + randomUUID()
                ),
                '23503',
                'StripeAccountCreationRequest_specialistId_fkey'
            );
        });

        await t.test('5 - Segunda solicitud independiente', async () => {
            const result = await insertRequest(
                requestB, specialistB, keyB
            );

            assert.equal(result.rows[0].status, 'PENDING');
            assert.equal(result.rows[0].stripeAccountId, null);
            assert.equal(result.rows[0].processingToken, null);
        });

        await t.test('6 - Identificador Stripe duplicado', async () => {
            await client.query(`
                UPDATE public."StripeAccountCreationRequest"
                SET "stripeAccountId" = $1
                WHERE "id" = $2
            `, [accountId, requestA]);

            await expectViolation(
                () => client.query(`
                    UPDATE public."StripeAccountCreationRequest"
                    SET "stripeAccountId" = $1
                    WHERE "id" = $2
                `, [accountId, requestB]),
                '23505',
                'StripeAccountCreationRequest_stripeAccountId_key'
            );
        });

        await t.test('7 - Token de procesamiento duplicado', async () => {
            await client.query(`
                UPDATE public."StripeAccountCreationRequest"
                SET "processingToken" = $1
                WHERE "id" = $2
            `, [token, requestA]);

            await expectViolation(
                () => client.query(`
                    UPDATE public."StripeAccountCreationRequest"
                    SET "processingToken" = $1
                    WHERE "id" = $2
                `, [token, requestB]),
                '23505',
                'StripeAccountCreationRequest_processingToken_key'
            );
        });

        await t.test('8 - Estado no reconocido', async () => {
            await expectViolation(
                () => client.query(`
                    UPDATE public."StripeAccountCreationRequest"
                    SET "status" = 'INVALID_STATE'
                    WHERE "id" = $1
                `, [requestA]),
                '22P02'
            );
        });

        await t.test('9 - Cinco estados reconocidos', async () => {
            for (const state of [
                'PENDING',
                'PROCESSING',
                'SUCCEEDED',
                'FAILED',
                'UNCERTAIN'
            ]) {
                const result = await client.query(`
                    UPDATE public."StripeAccountCreationRequest"
                    SET "status" =
                        $1::public."StripeAccountCreationStatus"
                    WHERE "id" = $2
                    RETURNING "status"
                `, [state, requestA]);

                assert.equal(result.rows[0].status, state);
            }
        });

        await t.test('10 - Eliminacion de especialista bloqueada', async () => {
            await expectViolation(
                () => client.query(`
                    DELETE FROM public."Specialist"
                    WHERE "id" = $1
                `, [specialistA]),
                '23503',
                'StripeAccountCreationRequest_specialistId_fkey'
            );
        });

        await t.test('11 - Rollback e inventario conservado', async () => {
            await client.query('ROLLBACK');
            transaction = false;

            assert.deepEqual(await inventory(), before);

            const result = await client.query(`
                SELECT COUNT(*)::int AS total
                FROM public."StripeAccountCreationRequest"
                WHERE "id" IN ($1, $2)
            `, [requestA, requestB]);

            assert.equal(result.rows[0].total, 0);
        });

    } finally {
        try {
            if (transaction)
                await client.query('ROLLBACK');
        } finally {
            await client.end();
        }
    }
});
