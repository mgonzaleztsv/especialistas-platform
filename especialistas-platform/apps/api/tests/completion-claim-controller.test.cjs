
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

function fixture({
  authorized = true,
  ownsJob = true,
  hoursRemaining = 24,
  existing = 0
} = {}) {
  const claims = [];
  const clientId = 'client-792';
  const jobId = 'job-792';

  const prisma = {
    client: {
      findUnique: async () =>
        authorized ? { id: clientId } : null
    },
    jobRequest: {
      findFirst: async ({ where }) => {
        if (!ownsJob || where.clientId !== clientId) return null;
        if (where.status !== 'AWAITING_CLIENT_CONFIRMATION')
          return null;
        return {
          id: jobId,
          reviewDeadline: new Date(
            Date.now() + hoursRemaining * 3600000
          )
        };
      }
    },
    completionClaim: {
      count: async () => existing + claims.length,
      create: async ({ data }) => {
        const claim = { id: 'claim-792', ...data };
        claims.push(claim);
        return claim;
      }
    }
  };

  prisma.$queryRaw = async (strings, ...values) => {
    const sql = strings.join('?');

    assert.match(sql, /FROM "JobRequest"/);
    assert.match(sql, /FOR UPDATE/);
    assert.equal(values.length, 1);
    assert.equal(values[0], jobId);

    return [{ id: jobId }];
  };

  prisma.$transaction = async fn => fn(prisma);

  const controller = Object.create(
    JobRequestsController.prototype
  );

  controller.prisma = prisma;
  controller.retryTransaction = async fn => fn();

  return {
    controller,
    claims,
    req: { user: { userId: 'user-792' } },
    jobId
  };
}

test('792.1 - Cliente autorizado puede reclamar', async () => {
  const f = fixture();

  const result = await f.controller.createCompletionClaim(
    f.req,
    f.jobId,
    { description: 'El trabajo quedó incompleto' }
  );

  assert.equal(result.status, 'PENDING');
  assert.equal(result.clientId, 'client-792');
  assert.equal(f.claims.length, 1);
});

test('792.2 - Usuario sin perfil de cliente rechazado', async () => {
  const f = fixture({ authorized: false });

  await assert.rejects(
    f.controller.createCompletionClaim(
      f.req,
      f.jobId,
      { description: 'Trabajo incompleto' }
    ),
    error => error.status === 400
  );

  assert.equal(f.claims.length, 0);
});

test('792.3 - Plazo vencido rechazado', async () => {
  const f = fixture({ hoursRemaining: -1 });

  await assert.rejects(
    f.controller.createCompletionClaim(
      f.req,
      f.jobId,
      { description: 'Trabajo incompleto' }
    ),
    error => error.status === 409
  );

  assert.equal(f.claims.length, 0);
});

test('792.4 - Reclamación duplicada rechazada', async () => {
  const f = fixture({ existing: 1 });

  await assert.rejects(
    f.controller.createCompletionClaim(
      f.req,
      f.jobId,
      { description: 'Trabajo incompleto' }
    ),
    error => error.status === 409
  );

  assert.equal(f.claims.length, 0);
});

test('792.5 - Descripción demasiado corta rechazada', async () => {
  const f = fixture();

  await assert.rejects(
    f.controller.createCompletionClaim(
      f.req,
      f.jobId,
      { description: 'Mal' }
    ),
    error => error.status === 400
  );

  assert.equal(f.claims.length, 0);
});

test('793.1 - Otro cliente no puede reclamar trabajo ajeno', async () => {
  const f = fixture({ ownsJob: false });

  await assert.rejects(
    f.controller.createCompletionClaim(
      f.req,
      f.jobId,
      { description: 'Intento de reclamación de un tercero' }
    ),
    error => error.status === 409
  );

  assert.equal(f.claims.length, 0);
});
