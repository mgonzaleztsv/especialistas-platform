
const test = require('node:test');
const assert = require('node:assert/strict');

require('reflect-metadata');

const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

const {
  GUARDS_METADATA,
  PATH_METADATA,
  METHOD_METADATA
} = require('@nestjs/common/constants');

const {
  RequestMethod
} = require('@nestjs/common');

const {
  JwtAuthGuard
} = require('../dist/common/guards/jwt-auth.guard.js');

const {
  AdminGuard
} = require('../dist/auth/admin.guard.js');

function controllerConSimulador(status = 'DISPUTED') {
  const operaciones = [];
  let estado = status;

  const controller = Object.create(
    JobRequestsController.prototype
  );

  controller.retryTransaction = async fn => fn();

  const tx = {
    $queryRaw: async () => {
      operaciones.push('LOCK_JOB');
      return [{ id: 'job-test' }];
    },

    completionClaim: {
      findFirst: async args => {
        operaciones.push('FIND_CLAIM');

        if (
          args.where.id !== 'claim-test' ||
          args.where.jobRequestId !== 'job-test' ||
          !args.where.status.in.includes(estado)
        ) {
          return null;
        }

        return { id: 'claim-test' };
      },

      updateMany: async args => {
        operaciones.push('UPDATE_CLAIM');

        if (!args.where.status.in.includes(estado)) {
          return { count: 0 };
        }

        estado = args.data.status;

        assert.ok(['RESOLVED', 'REJECTED'].includes(estado));
        assert.ok(args.data.resolvedAt instanceof Date);
        assert.ok(args.data.resolutionNotes.length >= 10);

        return { count: 1 };
      },

      findUniqueOrThrow: async () => {
        operaciones.push('READ_RESULT');

        return {
          id: 'claim-test',
          jobRequestId: 'job-test',
          status: estado
        };
      }
    }
  };

  controller.prisma = {
    $transaction: async (fn, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      return fn(tx);
    }
  };

  return { controller, operaciones };
}

test('867.1 - Ruta protegida para administradores', () => {
  const method =
    JobRequestsController.prototype.resolveCompletionClaimByAdmin;

  assert.equal(
    Reflect.getMetadata(PATH_METADATA, method),
    ':id/completion-claims/:claimId/resolve'
  );

  assert.equal(
    Reflect.getMetadata(METHOD_METADATA, method),
    RequestMethod.POST
  );

  const guards = Reflect.getMetadata(
    GUARDS_METADATA,
    method
  ) || [];

  assert.ok(guards.includes(JwtAuthGuard));
  assert.ok(guards.includes(AdminGuard));
});

test('867.2 - Rechaza decisiones inválidas', async () => {
  const { controller, operaciones } = controllerConSimulador();

  await assert.rejects(
    controller.resolveCompletionClaimByAdmin(
      'job-test',
      'claim-test',
      {
        decision: 'PAY',
        resolutionNotes: 'Decisión administrativa válida'
      }
    ),
    /RESOLVED o REJECTED/
  );

  assert.equal(operaciones.length, 0);
});

test('867.3 - Rechaza justificaciones insuficientes', async () => {
  const { controller, operaciones } = controllerConSimulador();

  await assert.rejects(
    controller.resolveCompletionClaimByAdmin(
      'job-test',
      'claim-test',
      {
        decision: 'RESOLVED',
        resolutionNotes: 'Corta'
      }
    ),
    /justificación/
  );

  assert.equal(operaciones.length, 0);
});

test('867.4 - Guarda resolución sin modificar pagos', async () => {
  const { controller, operaciones } = controllerConSimulador();

  const resultado =
    await controller.resolveCompletionClaimByAdmin(
      'job-test',
      'claim-test',
      {
        decision: 'RESOLVED',
        resolutionNotes: 'Resolución administrativa de prueba'
      }
    );

  assert.equal(resultado.status, 'RESOLVED');

  assert.deepEqual(operaciones, [
    'LOCK_JOB',
    'FIND_CLAIM',
    'UPDATE_CLAIM',
    'READ_RESULT'
  ]);
});

test('867.5 - Guarda rechazo administrativo', async () => {
  const { controller } = controllerConSimulador(
    'CORRECTION_REQUESTED'
  );

  const resultado =
    await controller.resolveCompletionClaimByAdmin(
      'job-test',
      'claim-test',
      {
        decision: 'REJECTED',
        resolutionNotes: 'Rechazo administrativo fundamentado'
      }
    );

  assert.equal(resultado.status, 'REJECTED');
});

test('867.6 - Rechaza reclamaciones pendientes', async () => {
  const { controller } = controllerConSimulador('PENDING');

  await assert.rejects(
    controller.resolveCompletionClaimByAdmin(
      'job-test',
      'claim-test',
      {
        decision: 'RESOLVED',
        resolutionNotes: 'Resolución administrativa de prueba'
      }
    ),
    /no está disponible/
  );
});

test('867.7 - Rechaza resolución duplicada', async () => {
  const { controller } = controllerConSimulador();

  const body = {
    decision: 'RESOLVED',
    resolutionNotes: 'Resolución administrativa de prueba'
  };

  await controller.resolveCompletionClaimByAdmin(
    'job-test',
    'claim-test',
    body
  );

  await assert.rejects(
    controller.resolveCompletionClaimByAdmin(
      'job-test',
      'claim-test',
      body
    ),
    /no está disponible/
  );
});
