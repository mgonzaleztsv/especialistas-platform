const test = require('node:test');
const assert = require('node:assert/strict');

require('reflect-metadata');

const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

function escenario(status, completedAt, deadline, respondedAt = null) {
  const registro = { escrituras: 0 };

  const claim = {
    id: 'claim-912',
    status,
    correctionCompletedAt: completedAt,
    correctionReviewDeadline: deadline,
    clientCorrectionRespondedAt: respondedAt
  };

  const tx = {
    $queryRaw: async () => [{ id: 'job-912' }],

    completionClaim: {
      findFirst: async ({ where, select }) => {
        assert.equal(where.id, 'claim-912');
        assert.equal(where.jobRequestId, 'job-912');
        assert.ok(select.correctionReviewDeadline);
        return claim;
      },

      updateMany: async ({ data }) => {
        registro.escrituras++;
        assert.equal(data.status, 'RESOLVED');
        return { count: 1 };
      },

      findUniqueOrThrow: async () => ({
        id: 'claim-912',
        status: 'RESOLVED'
      })
    }
  };

  const controller = Object.create(
    JobRequestsController.prototype
  );

  controller.prisma = {
    $transaction: async (fn, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      return fn(tx);
    }
  };

  controller.retryTransaction = async fn => fn();

  return { controller, registro };
}

async function resolver(controller) {
  return controller.resolveCompletionClaimByAdmin(
    'job-912',
    'claim-912',
    {
      decision: 'RESOLVED',
      resolutionNotes: 'Resolución administrativa debidamente justificada.'
    }
  );
}

test('912.1 - Impide cerrar una corrección todavía no terminada', async () => {
  const { controller, registro } = escenario(
    'CORRECTION_REQUESTED',
    null,
    null
  );

  await assert.rejects(
    resolver(controller),
    e => e.status === 409
  );

  assert.equal(registro.escrituras, 0);
});

test('912.2 - Protege el plazo vigente del cliente', async () => {
  const { controller, registro } = escenario(
    'CORRECTION_REQUESTED',
    new Date(),
    new Date(Date.now() + 3600000)
  );

  await assert.rejects(
    resolver(controller),
    e => e.status === 409
  );

  assert.equal(registro.escrituras, 0);
});

test('912.3 - Permite la decisión administrativa tras vencer el plazo', async () => {
  const { controller, registro } = escenario(
    'CORRECTION_REQUESTED',
    new Date(Date.now() - 86400000),
    new Date(Date.now() - 3600000)
  );

  const resultado = await resolver(controller);

  assert.equal(resultado.status, 'RESOLVED');
  assert.equal(registro.escrituras, 1);
});

test('912.4 - Permite resolver una reclamación ya disputada', async () => {
  const { controller, registro } = escenario(
    'DISPUTED',
    new Date(),
    new Date(Date.now() + 3600000),
    new Date()
  );

  const resultado = await resolver(controller);

  assert.equal(resultado.status, 'RESOLVED');
  assert.equal(registro.escrituras, 1);
});

test('912.5 - Rechaza cierre ordinario si ya existe respuesta del cliente', async () => {
  const { controller, registro } = escenario(
    'CORRECTION_REQUESTED',
    new Date(Date.now() - 86400000),
    new Date(Date.now() - 3600000),
    new Date()
  );

  await assert.rejects(
    resolver(controller),
    e => e.status === 409
  );

  assert.equal(registro.escrituras, 0);
});
