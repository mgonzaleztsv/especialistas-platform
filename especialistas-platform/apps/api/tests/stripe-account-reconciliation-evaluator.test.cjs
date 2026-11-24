const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const {
  evaluateStripeReconciliation: evaluate,
} = require('../dist/payments/stripe-account-reconciliation-evaluator.js');

const {
  buildStripeAccountCreationIdentity: build,
} = require('../dist/payments/stripe-account-creation-identity.js');

test('Stripe: evaluacion conjunta segura', async (t) => {
  const previousMode = process.env.STRIPE_MODE;

  try {
    process.env.STRIPE_MODE = 'test';

    const now = new Date('2026-11-24T18:00:00.000Z');
    const current = now.getTime();
    const minute = 60000;
    const hour = 60 * minute;

    const requestId = randomUUID();
    const otherId = randomUUID();
    const specialistId = randomUUID();

    const accountId = 'acct_Reconciliation123';
    const eventId = 'evt_Reconciliation123';

    function fixture() {
      return {
        request: {
          id: requestId,
          specialistId,
          country: 'MX',
          idempotencyKey:
            build(requestId).connectpro_reference,
          livemode: false,
          status: 'UNCERTAIN',
          attemptCount: 1,
          stripeAccountId: null,
          processingToken: null,
          processingAt: null,
          firstAttemptAt: new Date(current - hour),
          lastAttemptAt: new Date(current - hour),
          completedAt: null,
          lastErrorCode: 'EXTERNAL_TIMEOUT',
        },

        search: {
          requestId,
          expectedCountry: 'MX',
          livemode: false,
          observationStartedAt:
            new Date(current - 4 * minute),
          searchCompletedAt:
            new Date(current - 3 * minute),
          pagesScanned: 1,
          accountsScanned: 3,
          searchComplete: true,
          candidates: [{
            stripeAccountId: accountId,
            country: 'MX',
            countryMatches: true,
          }],
          candidateCount: 1,
          ambiguous: false,
          evidenceType: 'ACCOUNT_DISCOVERY',
          linkingAuthorized: false,
          retryAuthorized: false,
        },

        account: {
          requestId,
          stripeAccountId: accountId,
          country: 'MX',
          livemode: false,
          countryMatches: true,
          metadataMatches: true,
          observationStartedAt:
            new Date(current - 2 * minute),
          evidenceType: 'ACCOUNT_METADATA',
          candidateMatches: true,
          linkingAuthorized: false,
        },

        historical: {
          requestId,
          stripeAccountId: accountId,
          stripeEventId: eventId,
          livemode: false,
          eventCreatedAt:
            new Date(current - 59 * minute),
          observationStartedAt:
            new Date(current - minute),
          eventTypeMatches: true,
          eventContextMatches: true,
          accountMatches: true,
          countryMatches: true,
          metadataMatches: true,
          apiRequestPresent: true,
          idempotencyMatches: true,
          historicalEvidenceMatches: true,
          evidenceType: 'STRIPE_EVENT',
          linkingAuthorized: false,
        },
      };
    }

    function run(f) {
      return evaluate(
        f.request,
        f.search,
        f.account,
        f.historical,
        now
      );
    }

    function reject(change, reason) {
      const f = fixture();
      change(f);

      const r = run(f);

      assert.equal(r.evidenceCompatible, false);
      assert.equal(r.reason, reason);
      assert.equal(r.linkingAuthorized, false);
      assert.equal(r.retryAuthorized, false);
    }

    await t.test('1 - Modo desactivado bloqueado', () => {
      const f = fixture();
      delete process.env.STRIPE_MODE;

      try {
        assert.throws(() => run(f));
      } finally {
        process.env.STRIPE_MODE = 'test';
      }
    });

    await t.test('2 - Modo real bloqueado', () => {
      const f = fixture();
      process.env.STRIPE_MODE = 'live';

      try {
        assert.throws(() => run(f));
      } finally {
        process.env.STRIPE_MODE = 'test';
      }
    });

    await t.test('3 - Evidencia ausente', () => {
      for (const key of [
        'request', 'search', 'account', 'historical',
      ]) {
        reject(f => {
          f[key] = null;
        }, 'MISSING_EVIDENCE');
      }
    });

    await t.test('4 - Solicitud invalida', () => {
      reject(f => {
        f.request.id = 'invalid';
      }, 'INVALID_REQUEST_ID');
    });

    await t.test('5 - Especialista invalido', () => {
      for (const value of [null, '', ' invalid ']) {
        reject(f => {
          f.request.specialistId = value;
        }, 'INVALID_LOCAL_IDENTITY');
      }
    });

    await t.test('6 - Pais local invalido', () => {
      reject(f => {
        f.request.country = 'mex';
      }, 'INVALID_LOCAL_IDENTITY');
    });

    await t.test('7 - Idempotencia local alterada', () => {
      reject(f => {
        f.request.idempotencyKey = 'alterada';
      }, 'INVALID_LOCAL_IDENTITY');
    });

    await t.test('8 - Estados incompatibles', () => {
      for (const status of [
        'PENDING', 'PROCESSING',
        'SUCCEEDED', 'FAILED',
      ]) {
        reject(f => {
          f.request.status = status;
        }, 'INCOMPATIBLE_LOCAL_STATE');
      }
    });

    await t.test('9 - Solicitud real bloqueada', () => {
      reject(f => {
        f.request.livemode = true;
      }, 'INCOMPATIBLE_LOCAL_STATE');
    });

    await t.test('10 - Historial de intentos incompatible', () => {
      for (const count of [0, 2, -1]) {
        reject(f => {
          f.request.attemptCount = count;
        }, 'INCOMPATIBLE_LOCAL_STATE');
      }
    });

    await t.test('11 - Cuenta previamente vinculada', () => {
      reject(f => {
        f.request.stripeAccountId = accountId;
      }, 'INCOMPATIBLE_LOCAL_STATE');
    });

    await t.test('12 - Token previo bloqueado', () => {
      reject(f => {
        f.request.processingToken = randomUUID();
      }, 'INCOMPATIBLE_LOCAL_STATE');
    });

    await t.test('13 - Procesamiento activo bloqueado', () => {
      reject(f => {
        f.request.processingAt = now;
      }, 'INCOMPATIBLE_LOCAL_STATE');
    });

    await t.test('14 - Solicitud completada bloqueada', () => {
      reject(f => {
        f.request.completedAt = now;
      }, 'INCOMPATIBLE_LOCAL_STATE');
    });

    await t.test('15 - Fechas de intento ausentes', () => {
      for (const key of [
        'firstAttemptAt', 'lastAttemptAt',
      ]) {
        reject(f => {
          f.request[key] = null;
        }, 'INCOMPATIBLE_LOCAL_STATE');
      }
    });

    await t.test('16 - Error no autorizado', () => {
      for (const value of [
        null, 'INVALID',
        'EXTERNAL_REJECTION_CONFIRMED',
      ]) {
        reject(f => {
          f.request.lastErrorCode = value;
        }, 'INCOMPATIBLE_LOCAL_STATE');
      }
    });

    await t.test('17 - Evidencia real bloqueada', () => {
      for (const key of [
        'search', 'account', 'historical',
      ]) {
        reject(f => {
          f[key].livemode = true;
        }, 'INCOMPATIBLE_EVIDENCE_TYPE');
      }
    });

    await t.test('18 - Tipo de evidencia incompatible', () => {
      for (const key of [
        'search', 'account', 'historical',
      ]) {
        reject(f => {
          f[key].evidenceType = 'INVALID';
        }, 'INCOMPATIBLE_EVIDENCE_TYPE');
      }
    });

    await t.test('19 - Evidencia de otra solicitud', () => {
      for (const key of [
        'search', 'account', 'historical',
      ]) {
        reject(f => {
          f[key].requestId = otherId;
        }, 'REQUEST_ID_MISMATCH');
      }
    });

    await t.test('20 - Autorizaciones inesperadas', () => {
      for (const key of [
        'search', 'account', 'historical',
      ]) {
        reject(f => {
          f[key].linkingAuthorized = true;
        }, 'UNEXPECTED_AUTHORIZATION');
      }

      reject(f => {
        f.search.retryAuthorized = true;
      }, 'UNEXPECTED_AUTHORIZATION');
    });

    await t.test('21 - Pais de busqueda incompatible', () => {
      reject(f => {
        f.search.expectedCountry = 'ES';
      }, 'INCONCLUSIVE_DISCOVERY');
    });

    await t.test('22 - Busqueda incompleta', () => {
      reject(f => {
        f.search.searchComplete = false;
      }, 'INCONCLUSIVE_DISCOVERY');
    });

    await t.test('23 - Busqueda ambigua', () => {
      reject(f => {
        f.search.ambiguous = true;
      }, 'INCONCLUSIVE_DISCOVERY');
    });

    await t.test('24 - Ningun candidato', () => {
      reject(f => {
        f.search.candidateCount = 0;
        f.search.candidates = [];
      }, 'INCONCLUSIVE_DISCOVERY');
    });

    await t.test('25 - Multiples candidatos', () => {
      reject(f => {
        f.search.candidateCount = 2;

        f.search.candidates.push({
          stripeAccountId: 'acct_Other123',
          country: 'MX',
          countryMatches: true,
        });
      }, 'INCONCLUSIVE_DISCOVERY');
    });

    await t.test('26 - Lista de candidatos incompatible', () => {
      for (const value of [null, {}, [], 'invalid']) {
        reject(f => {
          f.search.candidates = value;
        }, 'INCONCLUSIVE_DISCOVERY');
      }
    });

    await t.test('27 - Numero de paginas invalido', () => {
      for (const value of [0, 11, 1.5, NaN]) {
        reject(f => {
          f.search.pagesScanned = value;
        }, 'INCONCLUSIVE_DISCOVERY');
      }
    });

    await t.test('28 - Numero de cuentas incompatible', () => {
      for (const value of [0, 101, -1, 1.5]) {
        reject(f => {
          f.search.accountsScanned = value;
        }, 'INCONCLUSIVE_DISCOVERY');
      }
    });

    await t.test('29 - Identidad candidata invalida', () => {
      reject(f => {
        f.search.candidates[0].stripeAccountId =
          'cus_Invalid';
      }, 'ACCOUNT_ID_MISMATCH');
    });

    await t.test('30 - Cuenta actual diferente', () => {
      reject(f => {
        f.account.stripeAccountId = 'acct_Other123';
      }, 'ACCOUNT_ID_MISMATCH');
    });

    await t.test('31 - Cuenta historica diferente', () => {
      reject(f => {
        f.historical.stripeAccountId = 'acct_Other123';
      }, 'ACCOUNT_ID_MISMATCH');
    });

    await t.test('32 - Discrepancia de pais', () => {
      reject(f => {
        f.search.candidates[0].country = 'ES';
      }, 'ACCOUNT_EVIDENCE_MISMATCH');

      reject(f => {
        f.account.country = 'ES';
      }, 'ACCOUNT_EVIDENCE_MISMATCH');
    });

    await t.test('33 - Evidencia actual insuficiente', () => {
      for (const key of [
        'countryMatches',
        'metadataMatches',
        'candidateMatches',
      ]) {
        reject(f => {
          f.account[key] = false;
        }, 'ACCOUNT_EVIDENCE_MISMATCH');
      }

      reject(f => {
        f.search.candidates[0].countryMatches = false;
      }, 'ACCOUNT_EVIDENCE_MISMATCH');
    });

    await t.test('34 - Identificador de evento invalido', () => {
      reject(f => {
        f.historical.stripeEventId = 'invalid';
      }, 'HISTORICAL_EVIDENCE_MISMATCH');
    });

    await t.test('35 - Evidencia historica insuficiente', () => {
      for (const key of [
        'eventTypeMatches',
        'eventContextMatches',
        'accountMatches',
        'countryMatches',
        'metadataMatches',
        'apiRequestPresent',
        'idempotencyMatches',
        'historicalEvidenceMatches',
      ]) {
        reject(f => {
          f.historical[key] = false;
        }, 'HISTORICAL_EVIDENCE_MISMATCH');
      }
    });

    await t.test('36 - Evento anterior al intento', () => {
      reject(f => {
        f.historical.eventCreatedAt =
          new Date(current - 2 * hour);
      }, 'EVENT_BEFORE_ATTEMPT');
    });

    await t.test('37 - Evidencia vencida', () => {
      reject(f => {
        f.search.observationStartedAt =
          new Date(current - 6 * minute);
      }, 'STALE_OBSERVATION');
    });

    await t.test('38 - Historial temporal incompatible', () => {
      reject(f => {
        f.request.lastAttemptAt =
          new Date(current - hour + 1);
      }, 'INCOMPATIBLE_ATTEMPT_HISTORY');
    });

    await t.test('39 - Evidencia conjunta compatible', () => {
      const f = fixture();
      const before = JSON.stringify(f);
      const r = run(f);

      assert.equal(r.evidenceCompatible, true);
      assert.equal(
        r.reason,
        'COMPLEMENTARY_EVIDENCE_COMPATIBLE'
      );

      assert.equal(r.requestId, requestId);
      assert.equal(r.specialistId, specialistId);
      assert.equal(r.stripeAccountId, accountId);
      assert.equal(r.stripeEventId, eventId);
      assert.equal(r.country, 'MX');
      assert.equal(r.livemode, false);
      assert.equal(r.linkingAuthorized, false);
      assert.equal(r.retryAuthorized, false);

      assert.equal(JSON.stringify(f), before);
    });

    await t.test('40 - Todos los errores inciertos admitidos', () => {
      for (const errorCode of [
        'EXTERNAL_TIMEOUT',
        'EXTERNAL_CONNECTION_ERROR',
        'EXTERNAL_RESULT_UNKNOWN',
        'EXTERNAL_RESPONSE_INVALID',
        'LOCAL_PERSISTENCE_ERROR',
        'LOCAL_PROCESSING_ABANDONED',
      ]) {
        const f = fixture();
        f.request.lastErrorCode = errorCode;

        const r = run(f);

        assert.equal(r.evidenceCompatible, true);
        assert.equal(r.linkingAuthorized, false);
        assert.equal(r.retryAuthorized, false);
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
