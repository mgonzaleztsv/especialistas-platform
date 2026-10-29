
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

test('807.1 - Reclamación abierta bloquea confirmación real', async () => {
  const url = new URL(process.env.DATABASE_URL || '');
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.equal(url.port, '5433');
  assert.equal(url.pathname, '/connectpro_test');

  const db = new PrismaClient();
  const marker = randomUUID().slice(0, 12);

  let userId, specialistUserId, clientId, specialistId;
  let categoryId, jobId;

  try {
    await db.$connect();

    const user = await db.user.create({
      data: {
        name: 'Cliente 807',
        email: `cliente807-${marker}@example.invalid`,
        passwordHash: 'TEST_ONLY',
        role: 'CLIENT'
      }
    });
    userId = user.id;

    const specialistUser = await db.user.create({
      data: {
        name: 'Especialista 807',
        email: `especialista807-${marker}@example.invalid`,
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
        name: `Categoría 807 ${marker}`,
        slug: `categoria-807-${marker}`
      }
    });
    categoryId = category.id;

    const job = await db.jobRequest.create({
      data: {
        clientId,
        categoryId,
        title: 'Trabajo ficticio 807',
        description: 'Confirmación bloqueada por reclamación',
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
        description: 'La reparación presenta defectos',
        status: 'PENDING'
      }
    });

    const controller = Object.create(
      JobRequestsController.prototype
    );
    controller.prisma = db;
    controller.retryTransaction = async fn => fn();

    // Solo este proceso de prueba utiliza la bandera temporal.
    const previous = process.env.INTERNAL_MVP_PAYMENTS_ENABLED;

    try {
      process.env.INTERNAL_MVP_PAYMENTS_ENABLED = 'true';

      await assert.rejects(
        controller.confirmJobCompletion(
          { user: { userId } },
          jobId
        ),
        error => error.status === 409
      );
    } finally {
      if (previous === undefined) {
        delete process.env.INTERNAL_MVP_PAYMENTS_ENABLED;
      } else {
        process.env.INTERNAL_MVP_PAYMENTS_ENABLED = previous;
      }
    }

    const finalPayment = await db.payment.findUniqueOrThrow({
      where: { id: payment.id }
    });

    const finalJob = await db.jobRequest.findUniqueOrThrow({
      where: { id: jobId }
    });

    assert.equal(finalPayment.status, 'PAID');
    assert.equal(finalPayment.releasedAt, null);
    assert.equal(finalJob.status, 'AWAITING_CLIENT_CONFIRMATION');

    console.log('CORRECTO - Reclamación bloqueó confirmación');
    console.log('CORRECTO - Pago conservó estado PAID');
    console.log('CORRECTO - Trabajo conservó estado pendiente');

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
      await db.$disconnect();
    }
  }
});
