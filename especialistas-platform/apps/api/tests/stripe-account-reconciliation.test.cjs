const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const {
  StripeAccountReconciliationService: Service,
} = require('../dist/payments/stripe-account-reconciliation.service.js');

const {
  buildStripeAccountCreationIdentity: build,
} = require('../dist/payments/stripe-account-creation-identity.js');

test('Stripe: orquestacion segura de conciliacion', async (t) => {
  const previousMode = process.env.STRIPE_MODE;

  try {
    process.env.STRIPE_MODE = 'test';

    const requestId = randomUUID();
    const specialistId = randomUUID();
    const accountId = 'acct_Orchestration123';
    const eventId = 'evt_Orchestration123';
    const country = 'MX';

    function fixture() {
      const now = Date.now();
      const first = now - 3600000;

      const request = {
        id: requestId,
        specialistId,
        country,
        idempotencyKey:
          build(requestId).connectpro_reference,
        livemode: false,
        status: 'UNCERTAIN',
        attemptCount: 1,
        stripeAccountId: null,
        processingToken: null,
        processingAt: null,
        firstAttemptAt: new Date(first),
        lastAttemptAt: new Date(first),
        completedAt: null,
        lastErrorCode: 'EXTERNAL_TIMEOUT',
        createdAt: new Date(first - 1000),
        updatedAt: new Date(first + 1000),
      };

      const state = {
        request,
        current: structuredClone(request),
        linkedBefore: null,
        linkedAfter: null,
        failAt: null,
        disableAt: null,

        search: {
          requestId,
          expectedCountry: country,
          livemode: false,
          evidenceType: 'ACCOUNT_DISCOVERY',
          observationStartedAt: new Date(now - 4000),
          searchCompletedAt: new Date(now - 3000),
          pagesScanned: 1,
          accountsScanned: 2,
          searchComplete: true,
          candidates: [{
            stripeAccountId: accountId,
            country,
            countryMatches: true,
          }],
          candidateCount: 1,
          ambiguous: false,
          linkingAuthorized: false,
          retryAuthorized: false,
        },

        account: {
          requestId,
          stripeAccountId: accountId,
          country,
          livemode: false,
          evidenceType: 'ACCOUNT_METADATA',
          countryMatches: true,
          metadataMatches: true,
          candidateMatches: true,
          observationStartedAt: new Date(now - 2000),
          linkingAuthorized: false,
        },

        historical: {
          requestId,
          stripeAccountId: accountId,
          stripeEventId: eventId,
          livemode: false,
          evidenceType: 'STRIPE_EVENT',
          eventCreatedAt: new Date(
            Math.floor((first + 60000) / 1000) * 1000
          ),
          observationStartedAt: new Date(now - 1000),
          eventTypeMatches: true,
          eventContextMatches: true,
          accountMatches: true,
          countryMatches: true,
          metadataMatches: true,
          apiRequestPresent: true,
          idempotencyMatches: true,
          historicalEvidenceMatches: true,
          linkingAuthorized: false,
        },
      };

      const calls = [];
      let reads = 0;

      function record(name, args) {
        calls.push({
          name,
          args: structuredClone(args),
        });

        if (state.disableAt === name) {
          process.env.STRIPE_MODE = 'disabled';
        }

        if (state.failAt === name) {
          throw new Error('SIMULATED_FAILURE');
        }
      }

      const prisma = {
        stripeAccountCreationRequest: {
          async findUnique(args) {
            reads++;

            record(
              reads === 1 ? 'request' : 'current',
              args
            );

            return structuredClone(
              reads === 1
                ? state.request
                : state.current
            );
          },
        },

        stripeConnectedAccount: {
          async findUnique(args) {
            record('linkedBefore', args);
            return state.linkedBefore;
          },

          async findFirst(args) {
            record('linkedAfter', args);
            return state.linkedAfter;
          },
        },
      };

      const search = {
        async searchCandidates(...args) {
          record('search', args);
          return structuredClone(state.search);
        },
      };

      const account = {
        async inspectCandidate(...args) {
          record('account', args);
          return structuredClone(state.account);
        },
      };

      const historical = {
        async inspectEvent(...args) {
          record('historical', args);
          return structuredClone(state.historical);
        },
      };

      const service = new Service(
        prisma,
        search,
        account,
        historical
      );

      return {
        state,
        calls,
        service,
        names() {
          return calls.map(c => c.name);
        },
        inspect() {
          return service.inspectUncertainRequest(
            requestId, eventId
          );
        },
      };
    }

    async function reject(change, reason, expectedCalls) {
      const f = fixture();
      change(f.state);

      const r = await f.inspect();

      assert.equal(r.evidenceCompatible, false);
      assert.equal(r.reason, reason);
      assert.equal(r.linkingAuthorized, false);
      assert.equal(r.retryAuthorized, false);

      if (expectedCalls) {
        assert.deepEqual(f.names(), expectedCalls);
      }
    }

    const initial = ['request'];

    const discovery = [
      'request', 'linkedBefore', 'search',
    ];

    const accountRead = [
      ...discovery, 'account',
    ];

    const historicalRead = [
      ...accountRead, 'historical',
    ];

    const reread = [
      ...historicalRead, 'current',
    ];

    const full = [
      ...reread, 'linkedAfter',
    ];

    await t.test('1 - Modo desactivado bloqueado', async () => {
      const f = fixture();
      delete process.env.STRIPE_MODE;

      try {
        await assert.rejects(f.inspect());
        assert.equal(f.calls.length, 0);
      } finally {
        process.env.STRIPE_MODE = 'test';
      }
    });

    await t.test('2 - Modo real bloqueado', async () => {
      const f = fixture();
      process.env.STRIPE_MODE = 'live';

      try {
        await assert.rejects(f.inspect());
        assert.equal(f.calls.length, 0);
      } finally {
        process.env.STRIPE_MODE = 'test';
      }
    });

    await t.test('3 - Solicitud invalida', async () => {
      const f = fixture();

      await assert.rejects(
        f.service.inspectUncertainRequest(
          'invalid', eventId
        )
      );

      assert.equal(f.calls.length, 0);
    });

    await t.test('4 - Evento invalido', async () => {
      const f = fixture();

      await assert.rejects(
        f.service.inspectUncertainRequest(
          requestId, 'invalid'
        )
      );

      assert.equal(f.calls.length, 0);
    });

    await t.test('5 - Solicitud inexistente', async () => {
      const f = fixture();
      f.state.request = null;

      await assert.rejects(
        f.inspect(),
        e => e.getStatus() === 404
      );

      assert.deepEqual(f.names(), initial);
    });

    await t.test('6 - Estados locales incompatibles', async () => {
      for (const status of [
        'PENDING', 'PROCESSING',
        'SUCCEEDED', 'FAILED',
      ]) {
        await reject(s => {
          s.request.status = status;
        }, 'INCOMPATIBLE_LOCAL_STATE', initial);
      }
    });

    await t.test('7 - Solicitud real rechazada', async () => {
      await reject(s => {
        s.request.livemode = true;
      }, 'INCOMPATIBLE_LOCAL_STATE', initial);
    });

    await t.test('8 - Idempotencia local alterada', async () => {
      await reject(s => {
        s.request.idempotencyKey = 'alterada';
      }, 'INCOMPATIBLE_LOCAL_STATE', initial);
    });

    await t.test('9 - Historial de intentos incompatible', async () => {
      await reject(s => {
        s.request.attemptCount = 2;
      }, 'INCOMPATIBLE_LOCAL_STATE', initial);
    });

    await t.test('10 - Token de procesamiento activo', async () => {
      await reject(s => {
        s.request.processingToken = randomUUID();
      }, 'INCOMPATIBLE_LOCAL_STATE', initial);
    });

    await t.test('11 - Fechas de intento invalidas', async () => {
      for (const value of [
        null,
        new Date(NaN),
        new Date(Date.now() + 60000),
      ]) {
        await reject(s => {
          s.request.firstAttemptAt = value;
        }, 'INCOMPATIBLE_LOCAL_STATE', initial);
      }
    });

    await t.test('12 - Error local incompatible', async () => {
      await reject(s => {
        s.request.lastErrorCode =
          'EXTERNAL_REJECTION_CONFIRMED';
      }, 'INCOMPATIBLE_LOCAL_STATE', initial);
    });

    await t.test('13 - Cuenta previamente vinculada', async () => {
      await reject(s => {
        s.linkedBefore = { id: randomUUID() };
      }, 'ACCOUNT_ALREADY_LINKED', [
        'request', 'linkedBefore',
      ]);
    });

    await t.test('14 - Busqueda incompleta', async () => {
      await reject(s => {
        s.search.searchComplete = false;
      }, 'INCONCLUSIVE_DISCOVERY', discovery);
    });

    await t.test('15 - Busqueda sin candidatos', async () => {
      await reject(s => {
        s.search.candidates = [];
        s.search.candidateCount = 0;
      }, 'INCONCLUSIVE_DISCOVERY', discovery);
    });

    await t.test('16 - Busqueda ambigua', async () => {
      await reject(s => {
        s.search.ambiguous = true;
      }, 'INCONCLUSIVE_DISCOVERY', discovery);
    });

    await t.test('17 - Busqueda de otra solicitud', async () => {
      await reject(s => {
        s.search.requestId = randomUUID();
      }, 'INCONCLUSIVE_DISCOVERY', discovery);
    });

    await t.test('18 - Autorizacion inesperada', async () => {
      for (const key of [
        'linkingAuthorized',
        'retryAuthorized',
      ]) {
        await reject(s => {
          s.search[key] = true;
        }, 'INCONCLUSIVE_DISCOVERY', discovery);
      }
    });

    await t.test('19 - Identificador candidato invalido', async () => {
      await reject(s => {
        s.search.candidates[0].stripeAccountId =
          'cus_Invalid';
      }, 'INVALID_CANDIDATE', discovery);
    });

    await t.test('20 - Pais candidato incompatible', async () => {
      await reject(s => {
        s.search.candidates[0].country = 'ES';
      }, 'INVALID_CANDIDATE', discovery);
    });

    await t.test('21 - Cuenta actual diferente', async () => {
      await reject(s => {
        s.account.stripeAccountId = 'acct_Other';
      }, 'ACCOUNT_EVIDENCE_MISMATCH', accountRead);
    });

    await t.test('22 - Metadatos actuales incompatibles', async () => {
      await reject(s => {
        s.account.metadataMatches = false;
      }, 'ACCOUNT_EVIDENCE_MISMATCH', accountRead);
    });

    await t.test('23 - Cuenta actual real', async () => {
      await reject(s => {
        s.account.livemode = true;
      }, 'ACCOUNT_EVIDENCE_MISMATCH', accountRead);
    });

    await t.test('24 - Evento diferente', async () => {
      await reject(s => {
        s.historical.stripeEventId = 'evt_Other';
      }, 'EVENT_ID_MISMATCH', historicalRead);
    });

    await t.test('25 - Evidencia historica insuficiente', async () => {
      await reject(s => {
        s.historical.idempotencyMatches = false;
      }, 'HISTORICAL_EVIDENCE_MISMATCH', full);
    });

    await t.test('26 - Solicitud eliminada durante consulta', async () => {
      await reject(s => {
        s.current = null;
      }, 'LOCAL_REQUEST_CHANGED', reread);
    });

    await t.test('27 - Estado local modificado', async () => {
      await reject(s => {
        s.current.status = 'SUCCEEDED';
      }, 'LOCAL_REQUEST_CHANGED', reread);
    });

    await t.test('28 - Fecha local modificada', async () => {
      await reject(s => {
        s.current.updatedAt = new Date();
      }, 'LOCAL_REQUEST_CHANGED', reread);
    });

    await t.test('29 - Cuenta vinculada durante consulta', async () => {
      await reject(s => {
        s.linkedAfter = { id: randomUUID() };
      }, 'ACCOUNT_ALREADY_LINKED', full);
    });

    await t.test('30 - Evidencia temporal vencida', async () => {
      await reject(s => {
        s.search.observationStartedAt =
          new Date(Date.now() - 600000);
      }, 'STALE_OBSERVATION', full);
    });

    await t.test('31 - Errores interrumpen consultas posteriores', async () => {
      for (const stage of full) {
        const f = fixture();
        f.state.failAt = stage;

        await assert.rejects(
          f.inspect(), /SIMULATED_FAILURE/
        );

        assert.deepEqual(
          f.names(),
          full.slice(0, full.indexOf(stage) + 1)
        );
      }
    });

    await t.test('32 - Desactivacion durante cada consulta', async () => {
      for (const stage of full) {
        const f = fixture();
        f.state.disableAt = stage;

        try {
          await assert.rejects(f.inspect());

          assert.deepEqual(
            f.names(),
            full.slice(0, full.indexOf(stage) + 1)
          );
        } finally {
          process.env.STRIPE_MODE = 'test';
        }
      }
    });

    await t.test('33 - Orden y argumentos exactos', async () => {
      const f = fixture();
      await f.inspect();

      assert.deepEqual(f.names(), full);

      assert.deepEqual(f.calls[0].args, {
        where: { id: requestId },
      });

      assert.deepEqual(f.calls[2].args, [
        requestId, country,
      ]);

      assert.deepEqual(f.calls[3].args, [
        requestId, accountId, country,
      ]);

      assert.deepEqual(f.calls[4].args, [
        requestId, accountId, eventId, country,
      ]);

      assert.deepEqual(f.calls[6].args, {
        where: {
          OR: [
            { specialistId },
            { stripeAccountId: accountId },
          ],
        },
        select: { id: true },
      });
    });

    await t.test('34 - Conciliacion compatible sin autorizacion', async () => {
      const f = fixture();
      const before = JSON.stringify(f.state);

      const r = await f.inspect();

      assert.equal(r.evidenceCompatible, true);
      assert.equal(
        r.reason,
        'COMPLEMENTARY_EVIDENCE_COMPATIBLE'
      );

      assert.equal(r.requestId, requestId);
      assert.equal(r.specialistId, specialistId);
      assert.equal(r.stripeAccountId, accountId);
      assert.equal(r.stripeEventId, eventId);
      assert.equal(r.livemode, false);
      assert.equal(r.linkingAuthorized, false);
      assert.equal(r.retryAuthorized, false);

      assert.equal(JSON.stringify(f.state), before);
      assert.deepEqual(f.names(), full);
    });

    await t.test('35 - Consultas simultaneas sin escrituras', async () => {
      const fixtures = Array.from(
        { length: 20 },
        () => fixture()
      );

      const results = await Promise.all(
        fixtures.map(f => f.inspect())
      );

      for (const r of results) {
        assert.equal(r.evidenceCompatible, true);
        assert.equal(r.linkingAuthorized, false);
        assert.equal(r.retryAuthorized, false);
      }

      for (const f of fixtures) {
        assert.deepEqual(f.names(), full);
        assert.equal(
          f.state.request.status,
          'UNCERTAIN'
        );
        assert.equal(
          f.state.request.stripeAccountId,
          null
        );
      }
    });

  } finally {
    if (previousMode === undefined) {
      delete process.env.STRIPE_MODE;
    } else {
      process.env.STRIPE_MODE = previousMode;
    }
  }
});
