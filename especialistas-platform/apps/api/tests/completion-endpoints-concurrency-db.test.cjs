
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
    for (let i = 0; i < 5; i++) {
      try {
        return await fn();
      } catch (e) {
        if (e.code !== 'P2034' || i === 4) throw e;
      }
    }
  };
  return c;
}

test('808.1 - Dos endpoints rechazan operar con reclamación abierta', async () => {
  const u = new URL(process.env.DATABASE_URL || '');
  assert.ok(['postgres:', 'postgresql:'].includes(u.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(u.hostname));
  assert.equal(u.port, '5433');
  assert.equal(u.pathname, '/connectpro_test');

  const db = new PrismaClient();
  const first = new PrismaClient();
  const second = new PrismaClient();
  const marker = randomUUID().slice(0, 12);

  let userId, specialistUserId, clientId, specialistId;
  let categoryId, jobId;

  try {
    await Promise.all([
      db.$connect(), first.$connect(), second.$connect()
    ]);

    const user = await db.user.create({
      data: {
        name: 'Cliente 808',
        email: `cliente808-${marker}@example.invalid`,
        passwordHash: 'TEST_ONLY',
        role: 'CLIENT'
      }
    });
    userId = user.id;

    const specialistUser = await db.user.create({
      data: {
        name: 'Especialista 808',
        email: `especialista808-${marker}@example.invalid`,
        passwordHash: 'TEST_ONLY',
        role: 'SPECIALIST'
      }
    });
    specialistUserId = specialistUser.id;

    const client = await db.client.create({
      data: { userId }
    });
    clientId = client.id;

    const specialist = await db.specialist.create({
      data: { userId: specialistUserId }
    });
    specialistId = specialist.id;

    const category = await db.category.create({
      data: {
        name: `Categoría 808 ${marker}`,
        slug: `categoria-808-${marker}`
      }
    });
    categoryId = category.id;

    const job = await db.jobRequest.create({
      data: {
        clientId,
        categoryId,
        title: 'Trabajo ficticio 808',
        description: 'Prueba de endpoints simultáneos',
        city: 'Chicago',
        state: 'IL',
        status: 'AWAITING_CLIENT_CONFIRMATION',
        reviewPeriodHours: 48,
        workCompletedAt: new Date(),
        reviewDeadline: new Date(Date.now() + 86400000)
      }
    });
    jobId = job.id;

    const proposal = await db.proposal.create({
      data: {
        jobRequestId: jobId,
        specialistId,
        amount: '150.00',
        status: 'ACCEPTED'
      }
    });

    const payment = await db.payment.create({
      data: {
        jobRequestId: jobId,
        proposalId: proposal.id,
        clientId,
        specialistId,
        amount: '150.00',
        status: 'PAID',
        provider: 'INTERNAL_MVP'
      }
    });

    await db.completionClaim.create({
      data: {
        jobRequestId: jobId,
        clientId,
        description: 'Reclamación previa sin resolver',
        status: 'PENDING'
      }
    });

    const req = { user: { userId } };

    const previous = process.env.INTERNAL_MVP_PAYMENTS_ENABLED;
    let results;

    try {
      // Habilitado solo en este proceso aislado de pruebas.
      process.env.INTERNAL_MVP_PAYMENTS_ENABLED = 'true';

      results = await Promise.allSettled([
        controller(first).createCompletionClaim(
          req, jobId,
          { description: 'Segunda reclamación simultánea' }
        ),
        controller(second).confirmJobCompletion(req, jobId)
      ]);
    } finally {
      if (previous === undefined) {
        delete process.env.INTERNAL_MVP_PAYMENTS_ENABLED;
      } else {
        process.env.INTERNAL_MVP_PAYMENTS_ENABLED = previous;
      }
    }

    assert.equal(
      results.filter(r => r.status === 'fulfilled').length, 0
    );
    assert.equal(
      results.filter(r => r.status === 'rejected').length, 2
    );

    const finalJob = await db.jobRequest.findUniqueOrThrow({
      where: { id: jobId }
    });

    const finalPayment = await db.payment.findUniqueOrThrow({
      where: { id: payment.id }
    });

    const claims = await db.completionClaim.findMany({
      where: { jobRequestId: jobId }
    });

    assert.equal(finalJob.status, 'AWAITING_CLIENT_CONFIRMATION');
    assert.equal(finalPayment.status, 'PAID');
    assert.equal(finalPayment.releasedAt, null);
    assert.equal(claims.length, 1);

    console.log('CORRECTO - Ambos endpoints rechazaron operar');
    console.log('CORRECTO - Reclamación original conservada');
    console.log('CORRECTO - Sin modificación del pago ni del trabajo');

  } finally {
    try {
      if (jobId) {
        await db.completionClaim.deleteMany({
          where: { jobRequestId: jobId }
        });
        await db.payment.deleteMany({
          where: { jobRequestId: jobId }
        });
        await db.proposal.deleteMany({
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
      if (specialistId) {
        await db.specialist.deleteMany({
          where: { id: specialistId }
        });
      }
      if (userId || specialistUserId) {
        await db.user.deleteMany({
          where: { id: { in: [userId, specialistUserId].filter(Boolean) } }
        });
      }
    } finally {
      await Promise.all([
        db.$disconnect(), first.$disconnect(), second.$disconnect()
      ]);
    }
  }
});
