const test = require('node:test');
const assert = require('node:assert/strict');
const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

function setup(options = {}) {
  const events = [];
  const claims = [{
    id: 'claim-1',
    jobRequestId: 'job-1',
    description: 'El servicio requiere correcciones',
    status: 'CORRECTION_REQUESTED',
    specialistResponseNotes: 'Acepto corregirlo',
    specialistRespondedAt: new Date(),
    resolutionNotes: null,
    resolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  }];

  const context = {
    prisma: {
      jobRequest: {
        findUnique: async args => {
          events.push('job');
          assert.equal(args.where.id, 'job-1');

          if (options.notFound) return null;

          return {
            id: 'job-1',
            client: { userId: 'client-user' },
            proposals: [{
              specialist: { userId: 'specialist-user' }
            }]
          };
        }
      },
      completionClaim: {
        findMany: async args => {
          events.push('claims');
          assert.equal(args.where.jobRequestId, 'job-1');
          assert.equal(args.orderBy.createdAt, 'desc');
          assert.equal(args.select.clientId, undefined);
          return claims;
        }
      }
    }
  };

  async function list(userId) {
    return JobRequestsController.prototype.getCompletionClaims.call(
      context,
      { user: { userId } },
      'job-1'
    );
  }

  return { list, events, claims };
}

test('831.1 - Cliente propietario autorizado', async () => {
  const s = setup();
  const result = await s.list('client-user');

  assert.equal(result.length, 1);
  assert.deepEqual(s.events, ['job', 'claims']);
});

test('831.2 - Especialista contratado autorizado', async () => {
  const s = setup();
  const result = await s.list('specialist-user');

  assert.equal(result[0].status, 'CORRECTION_REQUESTED');
  assert.deepEqual(s.events, ['job', 'claims']);
});

test('831.3 - Tercero rechazado', async () => {
  const s = setup();

  await assert.rejects(
    s.list('outsider-user'),
    error => error.status === 403
  );

  assert.deepEqual(s.events, ['job']);
});

test('831.4 - Trabajo inexistente rechazado', async () => {
  const s = setup({ notFound: true });

  await assert.rejects(
    s.list('client-user'),
    error => error.status === 404
  );

  assert.deepEqual(s.events, ['job']);
});

test('831.5 - Devuelve respuesta y fecha autorizadas', async () => {
  const s = setup();
  const result = await s.list('client-user');

  assert.equal(result[0].specialistResponseNotes,
    'Acepto corregirlo');
  assert.ok(result[0].specialistRespondedAt instanceof Date);
  assert.equal(result[0].resolutionNotes, null);
});
