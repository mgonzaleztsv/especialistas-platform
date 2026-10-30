
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

const { RequestMethod } = require('@nestjs/common');

const { JwtAuthGuard } =
  require('../dist/common/guards/jwt-auth.guard.js');

const { AdminGuard } =
  require('../dist/auth/admin.guard.js');

test('862.1 - Ruta protegida para administradores', () => {
  const method =
    JobRequestsController.prototype.getAdminCompletionClaims;

  assert.equal(
    Reflect.getMetadata(PATH_METADATA, method),
    'admin/completion-claims'
  );

  assert.equal(
    Reflect.getMetadata(METHOD_METADATA, method),
    RequestMethod.GET
  );

  const guards = Reflect.getMetadata(
    GUARDS_METADATA,
    method
  ) || [];

  assert.ok(guards.includes(JwtAuthGuard));
  assert.ok(guards.includes(AdminGuard));
});

test('862.2 - Consulta controlada y datos privados excluidos', async () => {
  let consultas = 0;

  const controller = Object.create(
    JobRequestsController.prototype
  );

  controller.prisma = {
    completionClaim: {
      findMany: async (args) => {
        consultas++;

        assert.equal(args.select.description, true);
        assert.equal(args.select.status, true);
        assert.equal(args.select.specialistResponseNotes, true);

        const job = args.select.jobRequest.select;

        assert.equal(job.title, true);
        assert.equal(job.city, true);
        assert.equal(job.state, true);

        assert.equal(job.client.select.user.select.name, true);

        assert.equal(
          Object.prototype.hasOwnProperty.call(job, 'privateAddress'),
          false
        );

        return [{
          id: 'claim-test',
          jobRequestId: 'job-test',
          description: 'Corrección solicitada',
          status: 'DISPUTED',
          specialistResponseNotes: 'El especialista no está de acuerdo',
          specialistRespondedAt: new Date('2026-10-29'),
          resolutionNotes: null,
          resolvedAt: null,
          createdAt: new Date('2026-10-29'),
          updatedAt: new Date('2026-10-29'),
          jobRequest: {
            id: 'job-test',
            title: 'Reparación de prueba',
            status: 'AWAITING_CLIENT_CONFIRMATION',
            city: 'Chicago',
            state: 'IL',
            client: {
              user: {
                id: 'client-test',
                name: 'Cliente de prueba'
              }
            },
            proposals: [{
              specialist: {
                user: {
                  id: 'specialist-test',
                  name: 'Especialista de prueba'
                }
              }
            }]
          }
        }];
      }
    }
  };

  const resultado =
    await controller.getAdminCompletionClaims();

  assert.equal(consultas, 1);
  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].status, 'DISPUTED');

  assert.equal(
    resultado[0].jobRequest.client.name,
    'Cliente de prueba'
  );

  assert.equal(
    resultado[0].jobRequest.specialist.name,
    'Especialista de prueba'
  );

  assert.equal(
    JSON.stringify(resultado).includes('privateAddress'),
    false
  );
});
