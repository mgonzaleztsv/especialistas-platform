const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const {
  StripeAccountCreationEvidenceService: Service,
} = require('../dist/payments/stripe-account-creation-evidence.service.js');

const {
  buildStripeAccountCreationIdentity: build,
} = require('../dist/payments/stripe-account-creation-identity.js');

test('Stripe: evidencia de conciliacion', async (t) => {
  const previousMode = process.env.STRIPE_MODE;

  try {
    process.env.STRIPE_MODE = 'test';

    const requestId = randomUUID();
    const otherId = randomUUID();
    const accountId = 'acct_EvidenceTest123';
    const country = 'MX';

    function validAccount() {
      return {
        id: accountId,
        object: 'account',
        country,
        livemode: false,
        metadata: build(requestId),
      };
    }

    function fixture(options = {}) {
      const calls = {
        client: 0,
        retrieve: [],
      };

      const service = new Service({
        getClient() {
          calls.client++;

          if (options.clientError) {
            throw new Error('Client unavailable');
          }

          return {
            accounts: {
              async retrieve(id) {
                calls.retrieve.push(id);

                if (options.disableDuringRead) {
                  process.env.STRIPE_MODE = 'disabled';
                }

                if (options.error) {
                  throw options.error;
                }

                if ('response' in options) {
                  return options.response;
                }

                return validAccount();
              },
            },
          };
        },
      });

      return {
        service,
        calls,
        inspect() {
          return service.inspectCandidate(
            requestId, accountId, country
          );
        },
      };
    }

    await t.test('1 - Modo desactivado bloqueado', async () => {
      const f = fixture();
      delete process.env.STRIPE_MODE;

      try {
        await assert.rejects(f.inspect());
        assert.equal(f.calls.client, 0);
      } finally {
        process.env.STRIPE_MODE = 'test';
      }
    });

    await t.test('2 - Modo real bloqueado', async () => {
      const f = fixture();
      process.env.STRIPE_MODE = 'live';

      try {
        await assert.rejects(f.inspect());
        assert.equal(f.calls.client, 0);
      } finally {
        process.env.STRIPE_MODE = 'test';
      }
    });

    await t.test('3 - Solicitudes invalidas', async () => {
      const f = fixture();

      for (const value of [null, '', 1, 'invalid']) {
        await assert.rejects(
          f.service.inspectCandidate(
            value, accountId, country
          )
        );
      }

      assert.equal(f.calls.client, 0);
    });

    await t.test('4 - Cuentas invalidas', async () => {
      const f = fixture();

      for (const value of [
        null, '', 'cus_123', 'acct_', 'acct_ 123',
        'acct_' + 'A'.repeat(256),
      ]) {
        await assert.rejects(
          f.service.inspectCandidate(
            requestId, value, country
          )
        );
      }

      assert.equal(f.calls.client, 0);
    });

    await t.test('5 - Paises invalidos', async () => {
      const f = fixture();

      for (const value of [
        null, '', 'mx', 'MEX', '1X', ' MX',
      ]) {
        await assert.rejects(
          f.service.inspectCandidate(
            requestId, accountId, value
          )
        );
      }

      assert.equal(f.calls.client, 0);
    });

    await t.test('6 - Cliente no disponible', async () => {
      const f = fixture({ clientError: true });
      await assert.rejects(f.inspect());
      assert.equal(f.calls.retrieve.length, 0);
    });

    await t.test('7 - Error externo sanitizado', async () => {
      const f = fixture({
        error: new Error('PRIVATE_EXTERNAL_MESSAGE'),
      });

      await assert.rejects(
        f.inspect(),
        error => {
          assert.equal(error.getStatus(), 502);
          assert.ok(
            !error.message.includes(
              'PRIVATE_EXTERNAL_MESSAGE'
            )
          );
          return true;
        }
      );
    });

    await t.test('8 - Respuesta ausente', async () => {
      const f = fixture({ response: null });
      await assert.rejects(f.inspect());
    });

    await t.test('9 - Objeto incompatible', async () => {
      const f = fixture({
        response: {
          ...validAccount(), object: 'customer',
        },
      });
      await assert.rejects(f.inspect());
    });

    await t.test('10 - Identificador externo diferente', async () => {
      const f = fixture({
        response: {
          ...validAccount(), id: 'acct_Other123',
        },
      });
      await assert.rejects(f.inspect());
    });

    await t.test('11 - Cuenta eliminada', async () => {
      const f = fixture({
        response: {
          ...validAccount(), deleted: true,
        },
      });
      await assert.rejects(f.inspect());
    });

    await t.test('12 - Cuenta real rechazada', async () => {
      const f = fixture({
        response: {
          ...validAccount(), livemode: true,
        },
      });
      await assert.rejects(f.inspect());
    });

    await t.test('13 - Indicador de modo invalido', async () => {
      const f = fixture({
        response: {
          ...validAccount(), livemode: 'false',
        },
      });
      await assert.rejects(f.inspect());
    });

    await t.test('14 - Pais externo invalido', async () => {
      const f = fixture({
        response: {
          ...validAccount(), country: 'mex',
        },
      });
      await assert.rejects(f.inspect());
    });

    await t.test('15 - Pais diferente', async () => {
      const f = fixture({
        response: {
          ...validAccount(), country: 'ES',
        },
      });

      const r = await f.inspect();

      assert.equal(r.countryMatches, false);
      assert.equal(r.metadataMatches, true);
      assert.equal(r.candidateMatches, false);
      assert.equal(r.linkingAuthorized, false);
    });

    await t.test('16 - Metadatos ausentes', async () => {
      const f = fixture({
        response: {
          ...validAccount(), metadata: null,
        },
      });

      const r = await f.inspect();

      assert.equal(r.metadataMatches, false);
      assert.equal(r.candidateMatches, false);
      assert.equal(r.linkingAuthorized, false);
    });

    await t.test('17 - Metadatos incompletos', async () => {
      const f = fixture({
        response: {
          ...validAccount(),
          metadata: {
            connectpro_request: requestId,
          },
        },
      });

      const r = await f.inspect();

      assert.equal(r.candidateMatches, false);
      assert.equal(r.linkingAuthorized, false);
    });

    await t.test('18 - Solicitud externa diferente', async () => {
      const f = fixture({
        response: {
          ...validAccount(),
          metadata: build(otherId),
        },
      });

      const r = await f.inspect();

      assert.equal(r.metadataMatches, false);
      assert.equal(r.candidateMatches, false);
    });

    await t.test('19 - Referencia alterada', async () => {
      const f = fixture({
        response: {
          ...validAccount(),
          metadata: {
            ...build(requestId),
            connectpro_reference: 'alterado',
          },
        },
      });

      const r = await f.inspect();

      assert.equal(r.metadataMatches, false);
      assert.equal(r.linkingAuthorized, false);
    });

    await t.test('20 - Desactivacion durante lectura', async () => {
      const f = fixture({
        disableDuringRead: true,
      });

      try {
        await assert.rejects(f.inspect());
      } finally {
        process.env.STRIPE_MODE = 'test';
      }
    });

    await t.test('21 - Candidato correcto', async () => {
      const f = fixture();
      const r = await f.inspect();

      assert.equal(r.requestId, requestId);
      assert.equal(r.stripeAccountId, accountId);
      assert.equal(r.country, country);
      assert.equal(r.countryMatches, true);
      assert.equal(r.metadataMatches, true);
      assert.equal(r.candidateMatches, true);
      assert.equal(r.livemode, false);
    });

    await t.test('22 - Una sola consulta externa simulada', async () => {
      const f = fixture();
      await f.inspect();

      assert.equal(f.calls.client, 1);
      assert.deepEqual(
        f.calls.retrieve, [accountId]
      );
    });

    await t.test('23 - Fecha de observacion valida', async () => {
      const f = fixture();
      const before = Date.now();
      const r = await f.inspect();

      assert.ok(
        r.observationStartedAt instanceof Date
      );

      assert.ok(
        r.observationStartedAt.getTime() >= before
      );

      assert.ok(
        r.observationStartedAt.getTime() <= Date.now()
      );
    });

    await t.test('24 - Resultado sin informacion sensible', async () => {
      const f = fixture({
        response: {
          ...validAccount(),
          email: 'private@example.invalid',
          external_accounts: {
            data: ['PRIVATE_BANK_DATA'],
          },
        },
      });

      const r = await f.inspect();

      assert.deepEqual(
        Object.keys(r).sort(),
        [
          'requestId',
          'stripeAccountId',
          'country',
          'livemode',
          'countryMatches',
          'metadataMatches',
          'observationStartedAt',
          'evidenceType',
          'candidateMatches',
          'linkingAuthorized',
        ].sort()
      );

      assert.equal(r.evidenceType, 'ACCOUNT_METADATA');
    });

    await t.test('25 - Coincidencia no autoriza vinculacion', async () => {
      const f = fixture();
      const r = await f.inspect();

      assert.equal(r.candidateMatches, true);
      assert.equal(r.linkingAuthorized, false);
    });

  } finally {
    if (previousMode === undefined) {
      delete process.env.STRIPE_MODE;
    } else {
      process.env.STRIPE_MODE = previousMode;
    }
  }
});
