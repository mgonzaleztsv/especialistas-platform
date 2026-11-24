const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateStripeEvidenceTime: evaluate,
} = require('../dist/payments/stripe-account-evidence-time.js');

test('Stripe: evaluacion temporal segura', async (t) => {
  const previousMode = process.env.STRIPE_MODE;

  try {
    process.env.STRIPE_MODE = 'test';

    const now = new Date('2026-11-24T18:00:00.000Z');
    const current = now.getTime();
    const minute = 60 * 1000;
    const hour = 60 * minute;

    function valid() {
      return {
        firstAttemptAt: new Date(current - hour),
        lastAttemptAt: new Date(current - hour),
        eventCreatedAt: new Date(current - 59 * minute),
        searchStartedAt: new Date(current - 4 * minute),
        searchCompletedAt: new Date(current - 3 * minute),
        accountObservedAt: new Date(current - 2 * minute),
        eventObservedAt: new Date(current - minute),
      };
    }

    function reject(input, reason, reference = now) {
      const result = evaluate(input, reference);

      assert.equal(result.temporalEvidenceMatches, false);
      assert.equal(result.reason, reason);
      assert.equal(result.linkingAuthorized, false);
      assert.equal(result.retryAuthorized, false);
    }

    function accept(input) {
      const result = evaluate(input, now);

      assert.equal(result.temporalEvidenceMatches, true);
      assert.equal(result.reason, 'TEMPORALLY_COMPATIBLE');
      assert.equal(result.linkingAuthorized, false);
      assert.equal(result.retryAuthorized, false);
    }

    await t.test('1 - Modo desactivado bloqueado', () => {
      delete process.env.STRIPE_MODE;

      try {
        assert.throws(() => evaluate(valid(), now));
      } finally {
        process.env.STRIPE_MODE = 'test';
      }
    });

    await t.test('2 - Modo real bloqueado', () => {
      process.env.STRIPE_MODE = 'live';

      try {
        assert.throws(() => evaluate(valid(), now));
      } finally {
        process.env.STRIPE_MODE = 'test';
      }
    });

    await t.test('3 - Entrada inexistente', () => {
      reject(null, 'INVALID_INPUT');
      reject(undefined, 'INVALID_INPUT');
    });

    await t.test('4 - Entrada incompatible', () => {
      reject('invalid', 'INVALID_INPUT');
      reject(123, 'INVALID_INPUT');
    });

    await t.test('5 - Fechas ausentes', () => {
      for (const key of Object.keys(valid())) {
        const input = valid();
        delete input[key];
        reject(input, 'INVALID_DATE');
      }
    });

    await t.test('6 - Fechas invalidas', () => {
      for (const key of Object.keys(valid())) {
        reject({
          ...valid(),
          [key]: new Date(NaN),
        }, 'INVALID_DATE');
      }
    });

    await t.test('7 - Tipos incompatibles', () => {
      for (const value of [null, 123, '2026-01-01', {}]) {
        reject({
          ...valid(),
          firstAttemptAt: value,
        }, 'INVALID_DATE');
      }
    });

    await t.test('8 - Reloj de referencia invalido', () => {
      reject(valid(), 'INVALID_DATE', new Date(NaN));
      reject(valid(), 'INVALID_DATE', null);
    });

    await t.test('9 - Fechas anteriores al origen', () => {
      reject({
        ...valid(),
        eventCreatedAt: new Date(-1000),
      }, 'INVALID_DATE');
    });

    await t.test('10 - Fechas futuras bloqueadas', () => {
      for (const key of Object.keys(valid())) {
        reject({
          ...valid(),
          [key]: new Date(current + 1000),
        }, 'FUTURE_DATE');
      }
    });

    await t.test('11 - Historial de intentos diferente', () => {
      reject({
        ...valid(),
        lastAttemptAt: new Date(current - hour + 1),
      }, 'INCOMPATIBLE_ATTEMPT_HISTORY');
    });

    await t.test('12 - Evento anterior al intento', () => {
      reject({
        ...valid(),
        eventCreatedAt: new Date(current - hour - 1000),
      }, 'EVENT_BEFORE_ATTEMPT');
    });

    await t.test('13 - Precision de segundos obligatoria', () => {
      reject({
        ...valid(),
        eventCreatedAt: new Date(
          current - 59 * minute + 1
        ),
      }, 'INVALID_EVENT_PRECISION');
    });

    await t.test('14 - Evento en el mismo segundo', () => {
      const input = valid();

      input.firstAttemptAt =
        new Date(current - hour + 900);

      input.lastAttemptAt =
        new Date(input.firstAttemptAt);

      input.eventCreatedAt =
        new Date(current - hour);

      accept(input);
    });

    await t.test('15 - Segundo anterior bloqueado', () => {
      const input = valid();

      input.firstAttemptAt =
        new Date(current - hour + 900);

      input.lastAttemptAt =
        new Date(input.firstAttemptAt);

      input.eventCreatedAt =
        new Date(current - hour - 1000);

      reject(input, 'EVENT_BEFORE_ATTEMPT');
    });

    await t.test('16 - Evento dentro de 24 horas', () => {
      const input = valid();

      input.firstAttemptAt =
        new Date(current - 25 * hour);

      input.lastAttemptAt =
        new Date(input.firstAttemptAt);

      input.eventCreatedAt =
        new Date(current - hour - 1000);

      accept(input);
    });

    await t.test('17 - Limite exacto de 24 horas', () => {
      const input = valid();

      input.firstAttemptAt =
        new Date(current - 25 * hour);

      input.lastAttemptAt =
        new Date(input.firstAttemptAt);

      input.eventCreatedAt =
        new Date(current - hour);

      reject(input, 'EVENT_OUTSIDE_WINDOW');
    });

    await t.test('18 - Evento posterior a 24 horas', () => {
      const input = valid();

      input.firstAttemptAt =
        new Date(current - 26 * hour);

      input.lastAttemptAt =
        new Date(input.firstAttemptAt);

      input.eventCreatedAt =
        new Date(current - hour);

      reject(input, 'EVENT_OUTSIDE_WINDOW');
    });

    await t.test('19 - Busqueda anterior al intento', () => {
      reject({
        ...valid(),
        searchStartedAt: new Date(current - 2 * hour),
      }, 'INCOMPATIBLE_OBSERVATION_ORDER');
    });

    await t.test('20 - Fin anterior al inicio', () => {
      reject({
        ...valid(),
        searchCompletedAt: new Date(current - 5 * minute),
      }, 'INCOMPATIBLE_OBSERVATION_ORDER');
    });

    await t.test('21 - Cuenta observada antes de busqueda', () => {
      reject({
        ...valid(),
        accountObservedAt: new Date(current - 4 * minute),
      }, 'INCOMPATIBLE_OBSERVATION_ORDER');
    });

    await t.test('22 - Evento consultado antes de cuenta', () => {
      reject({
        ...valid(),
        eventObservedAt: new Date(current - 3 * minute),
      }, 'INCOMPATIBLE_OBSERVATION_ORDER');
    });

    await t.test('23 - Evento posterior a su observacion', () => {
      reject({
        ...valid(),
        eventCreatedAt: new Date(current),
      }, 'INCOMPATIBLE_OBSERVATION_ORDER');
    });

    await t.test('24 - Observacion vencida', () => {
      reject({
        ...valid(),
        searchStartedAt: new Date(current - 6 * minute),
      }, 'STALE_OBSERVATION');
    });

    await t.test('25 - Limite exacto de cinco minutos', () => {
      accept({
        ...valid(),
        searchStartedAt: new Date(current - 5 * minute),
      });
    });

    await t.test('26 - Cinco minutos mas un milisegundo', () => {
      reject({
        ...valid(),
        searchStartedAt: new Date(current - 5 * minute - 1),
      }, 'STALE_OBSERVATION');
    });

    await t.test('27 - Observaciones simultaneas compatibles', () => {
      accept({
        ...valid(),
        searchStartedAt: new Date(current),
        searchCompletedAt: new Date(current),
        accountObservedAt: new Date(current),
        eventObservedAt: new Date(current),
      });
    });

    await t.test('28 - Evaluacion temporal satisfactoria', () => {
      accept(valid());
    });

    await t.test('29 - Fechas originales conservadas', () => {
      const input = valid();
      const before = JSON.stringify(input);

      accept(input);

      assert.equal(JSON.stringify(input), before);
    });

    await t.test('30 - Sin autorizaciones operativas', () => {
      const result = evaluate(valid(), now);

      assert.deepEqual(
        Object.keys(result).sort(),
        [
          'temporalEvidenceMatches',
          'reason',
          'linkingAuthorized',
          'retryAuthorized',
        ].sort()
      );

      assert.equal(result.linkingAuthorized, false);
      assert.equal(result.retryAuthorized, false);
    });

  } finally {
    if (previousMode === undefined) {
      delete process.env.STRIPE_MODE;
    } else {
      process.env.STRIPE_MODE = previousMode;
    }
  }
});
