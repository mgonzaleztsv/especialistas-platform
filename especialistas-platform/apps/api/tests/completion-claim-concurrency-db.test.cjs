
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

function controller(prisma) {
  const c = Object.create(JobRequestsController.prototype);
  c.prisma = prisma;
  c.retryTransaction = async fn => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (e.code !== 'P2034' || attempt === 4) throw e;
      }
    }
  };
  return c;
}

test('802.1 - Dos reclamaciones simultáneas, una sola abierta', async () => {
  const url = new URL(process.env.DATABASE_URL || '');

  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.equal(url.port, '5433');
  assert.equal(url.pathname, '/connectpro_test');

  const db = new PrismaClient();
  const first = new PrismaClient();
  const second = new PrismaClient();
  const marker = randomUUID().slice(0, 12);

  let userId = null;
  let clientId = null;
  let categoryId = null;
  let jobId = null;

  try {
    await Promise.all([
      db.$connect(),
      first.$connect(),
      second.$connect()
    ]);

    const user = await db.user.create({
      data: {
        name: 'Cliente concurrencia 802',
        email: `test802-${marker}@example.invalid`,
        passwordHash: 'TEST_ONLY',
        role: 'CLIENT'
      }
    });
    userId = user.id;

    const client = await db.client.create({
      data: { userId }
    });
    clientId = client.id;

    const category = await db.category.create({
      data: {
        name: `Categoría 802 ${marker}`,
        slug: `categoria-802-${marker}`
      }
    });
    categoryId = category.id;

    const job = await db.jobRequest.create({
      data: {
        clientId,
        categoryId,
        title: 'Trabajo de prueba de concurrencia',
        description: 'Reclamaciones simultáneas',
        city: 'Chicago',
        state: 'IL',
        status: 'AWAITING_CLIENT_CONFIRMATION',
        reviewPeriodHours: 48,
        workCompletedAt: new Date(),
        reviewDeadline: new Date(Date.now() + 86400000)
      }
    });
    jobId = job.id;

    const request = { user: { userId } };
    const body = {
      description: 'El trabajo necesita una corrección'
    };

    const results = await Promise.allSettled([
      controller(first).createCompletionClaim(request, jobId, body),
      controller(second).createCompletionClaim(request, jobId, body)
    ]);

    const succeeded = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    console.log('Solicitudes exitosas:', succeeded.length);
    console.log('Solicitudes rechazadas:', rejected.length);

    for (const r of rejected) {
      console.log('Rechazo:', String(r.reason?.message || r.reason).slice(0, 180));
    }

    const claims = await db.completionClaim.findMany({
      where: { jobRequestId: jobId }
    });

    assert.equal(succeeded.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(claims.length, 1);
    assert.equal(claims[0].status, 'PENDING');

    console.log('CORRECTO - Una sola reclamación registrada');
    console.log('CORRECTO - Solicitud simultánea duplicada rechazada');

  } finally {
    if (jobId) {
      await db.completionClaim.deleteMany({
        where: { jobRequestId: jobId }
      });
      await db.jobRequest.deleteMany({
        where: { id: jobId }
      });
    }
    if (categoryId) {
      await db.category.deleteMany({
        where: { id: categoryId }
      });
    }
    if (clientId) {
      await db.client.deleteMany({
        where: { id: clientId }
      });
    }
    if (userId) {
      await db.user.deleteMany({
        where: { id: userId }
      });
    }

    await Promise.all([
      db.$disconnect(),
      first.$disconnect(),
      second.$disconnect()
    ]);
  }
});
