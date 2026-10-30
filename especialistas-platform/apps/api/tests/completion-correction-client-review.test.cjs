const test = require('node:test');
const assert = require('node:assert/strict');

require('reflect-metadata');

const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

const {
  PATH_METADATA,
  GUARDS_METADATA
} = require('@nestjs/common/constants');

function preparar(opciones = {}) {
  const llamadas = {
    transacciones: 0,
    actualizaciones: 0,
    pagos: 0,
    trabajos: 0,
    datos: null,
    condiciones: null
  };

  const tx = {
    $queryRaw: async () =>
      opciones.bloqueo === false
        ? []
        : [{ id: 'job-902' }],

    jobRequest: {
      findFirst: async ({ where }) => {
        assert.equal(where.id, 'job-902');
        assert.equal(where.clientId, 'client-902');
        assert.equal(
          where.status,
          'AWAITING_CLIENT_CONFIRMATION'
        );

        return opciones.trabajo === false
          ? null
          : { id: 'job-902' };
      },

      updateMany: async () => {
        llamadas.trabajos++;
        throw new Error('No se debe modificar el trabajo');
      }
    },

    completionClaim: {
      findFirst: async ({ where }) => {
        assert.equal(where.id, 'claim-902');
        assert.equal(where.jobRequestId, 'job-902');
        assert.equal(where.clientId, 'client-902');
        assert.equal(where.status, 'CORRECTION_REQUESTED');
        assert.deepEqual(
          where.correctionCompletedAt,
          { not: null }
        );
        assert.equal(
          where.clientCorrectionRespondedAt,
          null
        );

        if (opciones.reclamacion === false) {
          return null;
        }

        return {
          id: 'claim-902',
          correctionReviewDeadline: new Date(
            Date.now() +
            (opciones.vencida ? -60000 : 600000)
          )
        };
      },

      updateMany: async ({ where, data }) => {
        llamadas.actualizaciones++;
        llamadas.datos = data;
        llamadas.condiciones = where;

        assert.equal(where.id, 'claim-902');
        assert.equal(where.jobRequestId, 'job-902');
        assert.equal(where.clientId, 'client-902');
        assert.equal(where.status, 'CORRECTION_REQUESTED');
        assert.equal(
          where.clientCorrectionRespondedAt,
          null
        );

        return {
          count: opciones.cambioConcurrente ? 0 : 1
        };
      },

      findUniqueOrThrow: async () => ({
        id: 'claim-902',
        status: llamadas.datos.status,
        clientCorrectionRespondedAt:
          llamadas.datos.clientCorrectionRespondedAt,
        clientCorrectionAcceptedAt:
          llamadas.datos.clientCorrectionAcceptedAt || null,
        clientCorrectionResponseNotes:
          llamadas.datos.clientCorrectionResponseNotes
      })
    },

    payment: {
      updateMany: async () => {
        llamadas.pagos++;
        throw new Error('No se debe modificar el pago');
      }
    }
  };

  const prisma = {
    client: {
      findUnique: async () =>
        opciones.cliente === false
          ? null
          : { id: 'client-902' }
    },

    $transaction: async (fn, config) => {
      llamadas.transacciones++;
      assert.equal(config.isolationLevel, 'Serializable');
      return fn(tx);
    }
  };

  const controller = Object.create(
    JobRequestsController.prototype
  );

  controller.prisma = prisma;
  controller.retryTransaction = async fn => fn();

  return { controller, llamadas };
}

function ejecutar(controller, action, notes = '') {
  return controller.reviewCompletedCorrectionByClient(
    { user: { userId: 'user-902' } },
    'job-902',
    'claim-902',
    { action, notes }
  );
}

function comprobarSeguridad(llamadas) {
  assert.equal(llamadas.pagos, 0);
  assert.equal(llamadas.trabajos, 0);
}

test('902.1 - Ruta protegida con autenticación', () => {
  const metodo =
    JobRequestsController.prototype.reviewCompletedCorrectionByClient;

  assert.equal(
    Reflect.getMetadata(PATH_METADATA, metodo),
    ':id/completion-claims/:claimId/correction-review'
  );

  const guards =
    Reflect.getMetadata(GUARDS_METADATA, metodo) || [];

  assert.ok(
    guards.some(g => g.name === 'JwtAuthGuard')
  );
});

test('902.2 - Cliente acepta las correcciones', async () => {
  const { controller, llamadas } = preparar();

  const resultado = await ejecutar(controller, 'ACCEPT');

  assert.equal(resultado.status, 'RESOLVED');
  assert.ok(
    resultado.clientCorrectionAcceptedAt instanceof Date
  );
  assert.ok(
    resultado.clientCorrectionRespondedAt instanceof Date
  );
  assert.equal(llamadas.actualizaciones, 1);
  assert.equal(llamadas.transacciones, 1);

  assert.match(
    resultado.clientCorrectionResponseNotes,
    /acepta expresamente/i
  );

  comprobarSeguridad(llamadas);
});

test('902.3 - Cliente disputa las correcciones', async () => {
  const { controller, llamadas } = preparar();

  const resultado = await ejecutar(
    controller,
    'DISPUTE',
    'La reparación todavía presenta defectos.'
  );

  assert.equal(resultado.status, 'DISPUTED');
  assert.equal(
    resultado.clientCorrectionAcceptedAt,
    null
  );

  assert.equal(
    resultado.clientCorrectionResponseNotes,
    'La reparación todavía presenta defectos.'
  );

  assert.ok(
    llamadas.condiciones.correctionReviewDeadline.gt
      instanceof Date
  );

  comprobarSeguridad(llamadas);
});

test('902.4 - Rechaza disputas fuera de plazo', async () => {
  const { controller, llamadas } = preparar({
    vencida: true
  });

  await assert.rejects(
    ejecutar(
      controller,
      'DISPUTE',
      'La reparación todavía presenta defectos.'
    ),
    e => e.status === 409
  );

  assert.equal(llamadas.actualizaciones, 0);
  comprobarSeguridad(llamadas);
});

test('902.5 - Rechaza decisiones inválidas', async () => {
  const { controller, llamadas } = preparar();

  await assert.rejects(
    ejecutar(controller, 'RELEASE'),
    e => e.status === 400
  );

  assert.equal(llamadas.transacciones, 0);
  comprobarSeguridad(llamadas);
});

test('902.6 - Disputa exige una explicación', async () => {
  const { controller, llamadas } = preparar();

  await assert.rejects(
    ejecutar(controller, 'DISPUTE', 'Mal'),
    e => e.status === 400
  );

  assert.equal(llamadas.transacciones, 0);
  comprobarSeguridad(llamadas);
});

test('902.7 - Rechaza usuarios sin perfil cliente', async () => {
  const { controller, llamadas } = preparar({
    cliente: false
  });

  await assert.rejects(
    ejecutar(controller, 'ACCEPT'),
    e => e.status === 403
  );

  assert.equal(llamadas.transacciones, 0);
  comprobarSeguridad(llamadas);
});

test('902.8 - Rechaza trabajos no autorizados', async () => {
  const { controller, llamadas } = preparar({
    trabajo: false
  });

  await assert.rejects(
    ejecutar(controller, 'ACCEPT'),
    e => e.status === 403
  );

  assert.equal(llamadas.actualizaciones, 0);
  comprobarSeguridad(llamadas);
});

test('902.9 - Rechaza reclamaciones no disponibles', async () => {
  const { controller, llamadas } = preparar({
    reclamacion: false
  });

  await assert.rejects(
    ejecutar(controller, 'ACCEPT'),
    e => e.status === 409
  );

  assert.equal(llamadas.actualizaciones, 0);
  comprobarSeguridad(llamadas);
});

test('902.10 - Rechaza una respuesta concurrente', async () => {
  const { controller, llamadas } = preparar({
    cambioConcurrente: true
  });

  await assert.rejects(
    ejecutar(controller, 'ACCEPT'),
    e => e.status === 409
  );

  assert.equal(llamadas.actualizaciones, 1);
  comprobarSeguridad(llamadas);
});

test('902.11 - Exige bloqueo previo del trabajo', async () => {
  const { controller, llamadas } = preparar({
    bloqueo: false
  });

  await assert.rejects(
    ejecutar(controller, 'ACCEPT'),
    e => e.status === 409
  );

  assert.equal(llamadas.actualizaciones, 0);
  comprobarSeguridad(llamadas);
});
