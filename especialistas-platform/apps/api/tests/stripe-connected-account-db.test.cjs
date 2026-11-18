const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('Stripe Connected Account: restricciones y rollback', async (t) => {
    assert.equal(process.env.NODE_ENV, 'test');
    assert.equal(process.env.STRIPE_MODE, 'disabled');
    assert.equal(process.env.INTERNAL_MVP_PAYMENTS_ENABLED, 'false');

    for (const name of Object.keys(process.env)) {
        if (name.toUpperCase().includes('STRIPE')) {
            assert.equal(name, 'STRIPE_MODE');
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
        connectionTimeoutMillis: 5000,
        statement_timeout: 10000,
        lock_timeout: 5000
    });

    await client.connect();

    let transaction = false;

    const users = [randomUUID(), randomUUID()];
    const specialists = [randomUUID(), randomUUID()];
    const accountId = 'acct_fictitious_' +
        randomUUID().replace(/-/g, '');

    async function insert(specialistId, stripeAccountId) {
        return client.query(`
            INSERT INTO public."StripeConnectedAccount" (
                id, "specialistId", "stripeAccountId",
                country, "updatedAt"
            )
            VALUES ($1, $2, $3, 'US', NOW())
            RETURNING *
        `, [randomUUID(), specialistId, stripeAccountId]);
    }

    async function expectRejected(code, constraint, operation) {
        await client.query('SAVEPOINT stripe_test');

        try {
            await assert.rejects(operation, error => {
                assert.equal(error.code, code);
                assert.equal(error.constraint, constraint);
                return true;
            });
        } finally {
            await client.query('ROLLBACK TO SAVEPOINT stripe_test');
            await client.query('RELEASE SAVEPOINT stripe_test');
        }
    }

    async function verifyCleanup() {
        const result = await client.query(`
            SELECT
                (SELECT COUNT(*)::int FROM public."User"
                 WHERE id = ANY($1::text[])) AS users,
                (SELECT COUNT(*)::int FROM public."Specialist"
                 WHERE id = ANY($2::text[])) AS specialists,
                (SELECT COUNT(*)::int
                 FROM public."StripeConnectedAccount"
                 WHERE "specialistId" = ANY($2::text[])
                    OR "stripeAccountId" = $3) AS accounts
        `, [users, specialists, accountId]);

        assert.deepEqual(result.rows[0], {
            users: 0,
            specialists: 0,
            accounts: 0
        });
    }

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

        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        transaction = true;

        for (let i = 0; i < 2; i++) {
            await client.query(`
                INSERT INTO public."User" (
                    id, name, email, "passwordHash",
                    role, "updatedAt"
                )
                VALUES ($1, $2, $3, $4, 'SPECIALIST', NOW())
            `, [
                users[i],
                'Stripe temporary test',
                users[i] + '@example.invalid',
                'NOT_A_VALID_PASSWORD_HASH'
            ]);

            await client.query(`
                INSERT INTO public."Specialist" (
                    id, "userId", "updatedAt"
                )
                VALUES ($1, $2, NOW())
            `, [specialists[i], users[i]]);
        }

        let account;

        await t.test('1 - Crear cuenta ficticia', async () => {
            const result = await insert(specialists[0], accountId);

            assert.equal(result.rowCount, 1);
            account = result.rows[0];
            assert.equal(account.specialistId, specialists[0]);
            assert.equal(account.stripeAccountId, accountId);
        });

        await t.test('2 - Habilitaciones desactivadas', () => {
            for (const field of [
                'livemode',
                'detailsSubmitted',
                'chargesEnabled',
                'payoutsEnabled'
            ]) {
                assert.equal(account[field], false);
            }

            assert.equal(account.transfersCapability, null);
            assert.equal(account.lastSyncedAt, null);
        });

        await t.test('3 - Especialista duplicado rechazado', async () => {
            await expectRejected(
                '23505',
                'StripeConnectedAccount_specialistId_key',
                () => insert(specialists[0], 'acct_' + randomUUID())
            );
        });

        await t.test('4 - Cuenta Stripe duplicada rechazada', async () => {
            await expectRejected(
                '23505',
                'StripeConnectedAccount_stripeAccountId_key',
                () => insert(specialists[1], accountId)
            );
        });

        await t.test('5 - Especialista inexistente rechazado', async () => {
            await expectRejected(
                '23503',
                'StripeConnectedAccount_specialistId_fkey',
                () => insert(randomUUID(), 'acct_' + randomUUID())
            );
        });

        await t.test('6 - Eliminacion directa rechazada', async () => {
            await expectRejected(
                '23503',
                'StripeConnectedAccount_specialistId_fkey',
                () => client.query(`
                    DELETE FROM public."Specialist"
                    WHERE id = $1
                `, [specialists[0]])
            );
        });

        await t.test('7 - Eliminacion indirecta rechazada', async () => {
            await expectRejected(
                '23503',
                'StripeConnectedAccount_specialistId_fkey',
                () => client.query(`
                    DELETE FROM public."User"
                    WHERE id = $1
                `, [users[0]])
            );
        });

    } finally {
        try {
            if (transaction) {
                await client.query('ROLLBACK');
            }

            await t.test('8 - Rollback sin registros residuales',
                verifyCleanup
            );
        } finally {
            await client.end();
        }
    }
});
