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
  const registro = {
    transacciones: 0,
    consultas: 0,
    actualizacionesReclamacion: 0,
    modificacionesPago: 0,
    modificacionesTrabajo: 0,
    datos: null
  };

  const tx = {
    $queryRaw: async () => {
      return opciones.bloqueo === false
        ? []
        : [{ id: 'job-898' }];
    },

    jobRequest: {
      findFirst: async ({ where }) => {
        assert.equal(where.id, 'job-898');
        assert.equal(
          where.status,
          'AWAITING_CLIENT_CONFIRMATION'
        );
        assert.equal(
          where.proposals.some.specialistId,
          'specialist-898'
        );

        return opciones.trabajo === false
          ? null
          : {
              id: 'job-898',
              reviewPeriodHours: opciones.horas ?? 48
            };
      },

      updateMany: async () => {
        registro.modificacionesTrabajo++;
        throw new Error('No debe modificarse el trabajo');
      }
    },

    completionClaim: {
      findFirst: async ({ where }) => {
        registro.consultas++;

        assert.equal(where.id, 'claim-898');
        assert.equal(where.jobRequestId, 'job-898');
        assert.equal(where.status, 'CORRECTION_REQUESTED');
        assert.equal(where.correctionCompletedAt, null);

        return opciones.reclamacion === false
          ? null
          : { id: 'claim-898' };
      },

      updateMany: async ({ where, data }) => {
        registro.actualizacionesReclamacion++;

        assert.equal(where.id, 'claim-898');
        assert.equal(where.jobRequestId, 'job-898');
        assert.equal(where.status, 'CORRECTION_REQUESTED');
        assert.equal(where.correctionCompletedAt, null);

        registro.datos = data;

        return {
          count: opciones.actualizacionFallida ? 0 : 1
        };
      },

      findUniqueOrThrow: async () => ({
        id: 'claim-898',
        jobRequestId: 'job-898',
        status: 'CORRECTION_REQUESTED',
        correctionCompletedAt: registro.datos.correctionCompletedAt,
        correctionReviewDeadline: registro.datos.correctionReviewDeadline,
        correctionCompletionNotes: registro.datos.correctionCompletionNotes,
        clientCorrectionAcceptedAt: null
      })
    },

    payment: {
      updateMany: async () => {
        registro.modificacionesPago++;
        throw new Error('No debe modificarse el pago');
      }
    }
  };

  const prisma = {
    specialist: {
      findUnique: async ({ where }) => {
        assert.equal(where.userId, 'user-898');

        return opciones.especialista === false
          ? null
          : { id: 'specialist-898' };
      }
    },

    $transaction: async (fn, config) => {
      registro.transacciones++;
      assert.equal(config.isolationLevel, 'Serializable');
      return fn(tx);
    }
  };

  const controller = Object.create(
    JobRequestsController.prototype
  );

  controller.prisma = prisma;
  controller.retryTransaction = async fn => fn();

  return { controller, registro };
}

function ejecutar(controller, notes = 'Corrección realizada correctamente') {
  return controller.completeCorrectionBySpecialist(
    { user: { userId: 'user-898' } },
    'job-898',
    'claim-898',
    { notes }
  );
}

function sinCambiosFinancieros(registro) {
  assert.equal(registro.modificacionesPago, 0);
  assert.equal(registro.modificacionesTrabajo, 0);
}

test('898.1 - La ruta exige autenticación', () => {
  const metodo =
    JobRequestsController.prototype.completeCorrectionBySpecialist;

  assert.equal(
    Reflect.getMetadata(PATH_METADATA, metodo),
    ':id/completion-claims/:claimId/correction-complete'
  );

  const guards = Reflect.getMetadata(
    GUARDS_METADATA, metodo
  ) || [];

  assert.ok(
    guards.some(x => x.name === 'JwtAuthGuard'),
    'La ruta debe utilizar JwtAuthGuard'
  );
});

for (const horas of [48, 168]) {
  test(`898 - Calcula correctamente ${horas} horas`, async () => {
    const { controller, registro } = preparar({ horas });

    const antes = Date.now();
    const resultado = await ejecutar(controller);
    const despues = Date.now();

    assert.equal(registro.transacciones, 1);
    assert.equal(registro.actualizacionesReclamacion, 1);

    const datos = registro.datos;

    assert.ok(datos.correctionCompletedAt instanceof Date);
    assert.ok(datos.correctionReviewDeadline instanceof Date);

    assert.ok(datos.correctionCompletedAt.getTime() >= antes);
    assert.ok(datos.correctionCompletedAt.getTime() <= despues);

    assert.equal(
      datos.correctionReviewDeadline.getTime() -
      datos.correctionCompletedAt.getTime(),
      horas * 60 * 60 * 1000
    );

    assert.equal(
      datos.correctionCompletionNotes,
      'Corrección realizada correctamente'
    );

    assert.equal(resultado.status, 'CORRECTION_REQUESTED');
    assert.equal(resultado.clientCorrectionAcceptedAt, null);

    sinCambiosFinancieros(registro);
  });
}

test('898.4 - Rechaza explicaciones demasiado cortas', async () => {
  const { controller, registro } = preparar();

  await assert.rejects(
    ejecutar(controller, 'Breve'),
    e => e.status === 400
  );

  assert.equal(registro.transacciones, 0);
  sinCambiosFinancieros(registro);
});

test('898.5 - Rechaza usuarios sin perfil especialista', async () => {
  const { controller, registro } = preparar({
    especialista: false
  });

  await assert.rejects(
    ejecutar(controller),
    e => e.status === 403
  );

  assert.equal(registro.transacciones, 0);
  sinCambiosFinancieros(registro);
});

test('898.6 - Rechaza trabajos no autorizados', async () => {
  const { controller, registro } = preparar({
    trabajo: false
  });

  await assert.rejects(
    ejecutar(controller),
    e => e.status === 403
  );

  assert.equal(registro.actualizacionesReclamacion, 0);
  sinCambiosFinancieros(registro);
});

test('898.7 - Rechaza reclamaciones no disponibles', async () => {
  const { controller, registro } = preparar({
    reclamacion: false
  });

  await assert.rejects(
    ejecutar(controller),
    e => e.status === 409
  );

  assert.equal(registro.actualizacionesReclamacion, 0);
  sinCambiosFinancieros(registro);
});

test('898.8 - Rechaza cambios concurrentes de reclamación', async () => {
  const { controller, registro } = preparar({
    actualizacionFallida: true
  });

  await assert.rejects(
    ejecutar(controller),
    e => e.status === 409
  );

  sinCambiosFinancieros(registro);
});

test('898.9 - Rechaza plazos distintos de 48 o 168 horas', async () => {
  const { controller, registro } = preparar({
    horas: 72
  });

  await assert.rejects(
    ejecutar(controller),
    e => e.status === 409
  );

  assert.equal(registro.actualizacionesReclamacion, 0);
  sinCambiosFinancieros(registro);
});

test('898.10 - Exige el bloqueo previo del trabajo', async () => {
  const { controller, registro } = preparar({
    bloqueo: false
  });

  await assert.rejects(
    ejecutar(controller),
    e => e.status === 409
  );

  assert.equal(registro.actualizacionesReclamacion, 0);
  sinCambiosFinancieros(registro);
});
