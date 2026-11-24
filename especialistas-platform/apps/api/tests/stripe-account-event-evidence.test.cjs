const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const {
  StripeAccountEventEvidenceService: Service,
} = require('../dist/payments/stripe-account-event-evidence.service.js');

const {
  buildStripeAccountCreationIdentity: build,
} = require('../dist/payments/stripe-account-creation-identity.js');

test('Stripe: evidencia historica segura', async (t) => {
  const previousMode = process.env.STRIPE_MODE;

  try {
    process.env.STRIPE_MODE = 'test';

    const requestId = randomUUID();
    const otherId = randomUUID();
    const accountId = 'acct_HistoricalTest123';
    const eventId = 'evt_HistoricalTest123';
    const country = 'MX';

    function validEvent() {
      return {
        id: eventId,
        object: 'event',
        type: 'account.updated',
        account: accountId,
        livemode: false,
        created: Math.floor(Date.now() / 1000) - 60,
        request: {
          id: 'req_HistoricalTest123',
          idempotency_key:
            build(requestId).connectpro_reference,
        },
        data: {
          object: {
            id: accountId,
            object: 'account',
            country,
            livemode: false,
            metadata: build(requestId),
          },
        },
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

          return {
            events: {
              async retrieve(id) {
                calls.retrieve.push(id);

                if (options.disable) {
                  process.env.STRIPE_MODE = 'disabled';
                }

                if (options.error) {
                  throw options.error;
                }

                if ('response' in options) {
                  return options.response;
                }

                const event = validEvent();

                if (options.change) {
                  options.change(event);
                }

                return event;
              },
            },
          };
        },
      });

      return {
        service,
        calls,
        inspect() {
          return service.inspectEvent(
            requestId, accountId, eventId, country
          );
        },
      };
    }

    async function mismatch(change, field) {
      const f = fixture({ change });
      const r = await f.inspect();

      assert.equal(r[field], false);
      assert.equal(r.historicalEvidenceMatches, false);
      assert.equal(r.linkingAuthorized, false);
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

    await t.test('3 - Solicitud invalida', async () => {
      const f = fixture();

      await assert.rejects(
        f.service.inspectEvent(
          'invalid', accountId, eventId, country
        )
      );

      assert.equal(f.calls.client, 0);
    });

    await t.test('4 - Cuenta invalida', async () => {
      const f = fixture();

      await assert.rejects(
        f.service.inspectEvent(
          requestId, 'cus_invalid', eventId, country
        )
      );

      assert.equal(f.calls.client, 0);
    });

    await t.test('5 - Evento invalido', async () => {
      const f = fixture();

      await assert.rejects(
        f.service.inspectEvent(
          requestId, accountId, 'invalid', country
        )
      );

      assert.equal(f.calls.client, 0);
    });

    await t.test('6 - Pais invalido', async () => {
      const f = fixture();

      await assert.rejects(
        f.service.inspectEvent(
          requestId, accountId, eventId, 'mex'
        )
      );

      assert.equal(f.calls.client, 0);
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

    await t.test('8 - Evento inexistente', async () => {
      const f = fixture({ response: null });
      await assert.rejects(f.inspect());
    });

    await t.test('9 - Objeto incompatible', async () => {
      const f = fixture({
        change: e => { e.object = 'account'; },
      });
      await assert.rejects(f.inspect());
    });

    await t.test('10 - Evento diferente', async () => {
      const f = fixture({
        change: e => { e.id = 'evt_Other123'; },
      });
      await assert.rejects(f.inspect());
    });

    await t.test('11 - Evento real bloqueado', async () => {
      const f = fixture({
        change: e => { e.livemode = true; },
      });
      await assert.rejects(f.inspect());
    });

    await t.test('12 - Modo ausente bloqueado', async () => {
      const f = fixture({
        change: e => { delete e.livemode; },
      });
      await assert.rejects(f.inspect());
    });

    await t.test('13 - Fecha invalida', async () => {
      for (const value of [null, 0, -1, NaN, 1.5, '123']) {
        const f = fixture({
          change: e => { e.created = value; },
        });
        await assert.rejects(f.inspect());
      }
    });

    await t.test('14 - Fecha futura bloqueada', async () => {
      const f = fixture({
        change: e => {
          e.created = Math.floor(Date.now() / 1000) + 600;
        },
      });
      await assert.rejects(f.inspect());
    });

    await t.test('15 - Tipo de evento incompatible', async () => {
      await mismatch(
        e => { e.type = 'account.application.authorized'; },
        'eventTypeMatches'
      );
    });

    await t.test('16 - Contexto de otra cuenta', async () => {
      await mismatch(
        e => { e.account = 'acct_Other123'; },
        'eventContextMatches'
      );
    });

    await t.test('17 - Contexto ausente', async () => {
      await mismatch(
        e => { delete e.account; },
        'eventContextMatches'
      );
    });

    await t.test('18 - Objeto historico ausente', async () => {
      await mismatch(
        e => { e.data = null; },
        'accountMatches'
      );
    });

    await t.test('19 - Cuenta historica diferente', async () => {
      await mismatch(
        e => { e.data.object.id = 'acct_Other123'; },
        'accountMatches'
      );
    });

    await t.test('20 - Cuenta eliminada', async () => {
      await mismatch(
        e => { e.data.object.deleted = true; },
        'accountMatches'
      );
    });

    await t.test('21 - Cuenta historica real', async () => {
      await mismatch(
        e => { e.data.object.livemode = true; },
        'accountMatches'
      );
    });

    await t.test('22 - Pais historico diferente', async () => {
      await mismatch(
        e => { e.data.object.country = 'ES'; },
        'countryMatches'
      );
    });

    await t.test('23 - Metadatos ausentes', async () => {
      await mismatch(
        e => { delete e.data.object.metadata; },
        'metadataMatches'
      );
    });

    await t.test('24 - Otra solicitud en metadatos', async () => {
      await mismatch(
        e => { e.data.object.metadata = build(otherId); },
        'metadataMatches'
      );
    });

    await t.test('25 - Solicitud API ausente', async () => {
      await mismatch(
        e => { e.request = null; },
        'apiRequestPresent'
      );
    });

    await t.test('26 - Identificador API invalido', async () => {
      await mismatch(
        e => { e.request.id = 'invalid'; },
        'apiRequestPresent'
      );
    });

    await t.test('27 - Idempotencia incompatible', async () => {
      for (const value of [null, undefined, 'alterada']) {
        await mismatch(
          e => { e.request.idempotency_key = value; },
          'idempotencyMatches'
        );
      }
    });

    await t.test('28 - Desactivacion durante consulta', async () => {
      const f = fixture({ disable: true });

      try {
        await assert.rejects(f.inspect());
      } finally {
        process.env.STRIPE_MODE = 'test';
      }
    });

    await t.test('29 - Evidencia compatible sin autorizacion', async () => {
      const f = fixture();
      const r = await f.inspect();

      for (const field of [
        'eventTypeMatches',
        'eventContextMatches',
        'accountMatches',
        'countryMatches',
        'metadataMatches',
        'apiRequestPresent',
        'idempotencyMatches',
        'historicalEvidenceMatches',
      ]) {
        assert.equal(r[field], true);
      }

      assert.equal(r.requestId, requestId);
      assert.equal(r.stripeAccountId, accountId);
      assert.equal(r.stripeEventId, eventId);
      assert.equal(r.evidenceType, 'STRIPE_EVENT');
      assert.equal(r.livemode, false);
      assert.equal(r.linkingAuthorized, false);

      assert.ok(r.eventCreatedAt instanceof Date);
      assert.ok(r.observationStartedAt instanceof Date);

      assert.ok(
        r.eventCreatedAt.getTime() <=
        r.observationStartedAt.getTime()
      );

      assert.equal(f.calls.client, 1);
      assert.deepEqual(f.calls.retrieve, [eventId]);
    });

    await t.test('30 - Resultado limitado y sin datos sensibles', async () => {
      const f = fixture({
        change: e => {
          e.data.object.email = 'private@example.invalid';
          e.data.object.external_accounts = {
            data: ['PRIVATE_BANK_DATA'],
          };
        },
      });

      const r = await f.inspect();

      assert.deepEqual(
        Object.keys(r).sort(),
        [
          'requestId',
          'stripeAccountId',
          'stripeEventId',
          'livemode',
          'eventCreatedAt',
          'observationStartedAt',
          'eventTypeMatches',
          'eventContextMatches',
          'accountMatches',
          'countryMatches',
          'metadataMatches',
          'apiRequestPresent',
          'idempotencyMatches',
          'evidenceType',
          'historicalEvidenceMatches',
          'linkingAuthorized',
        ].sort()
      );

      assert.equal(r.historicalEvidenceMatches, true);
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
