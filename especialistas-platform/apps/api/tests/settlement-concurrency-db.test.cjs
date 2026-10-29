
const test = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

function verifyUrl() {
  const url = new URL(process.env.DATABASE_URL || '');
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.equal(url.port, '5433');
  assert.equal(url.pathname, '/connectpro_test');
  assert.notEqual(process.env.INTERNAL_MVP_PAYMENTS_ENABLED, 'true');
}

function controller(prisma) {
  const instance = Object.create(
    JobRequestsController.prototype
  );
  instance.prisma = prisma;
  return instance;
}

test('751.1 - Liquidaciones simultáneas sin duplicados', async () => {
  verifyUrl();

  const db = new PrismaClient();
  const first = new PrismaClient();
  const second = new PrismaClient();

  let jobId = null;
  let clientUserId = null;
  let specialistUserId = null;
  let categoryId = null;

  try {
    await Promise.all([
      db.$connect(),
      first.$connect(),
      second.$connect()
    ]);

    const suffix = Date.now() + '-' + process.pid;

    const clientUser = await db.user.create({
      data: {
        name: 'Cliente liquidacion751',
        email: 'cliente751-' + suffix + '@example.invalid',
        passwordHash: 'TEST_ONLY',
        role: 'CLIENT'
      }
    });
    clientUserId = clientUser.id;

    const specialistUser = await db.user.create({
      data: {
        name: 'Especialista liquidacion751',
        email: 'especialista751-' + suffix + '@example.invalid',
        passwordHash: 'TEST_ONLY',
        role: 'SPECIALIST'
      }
    });
    specialistUserId = specialistUser.id;

    const client = await db.client.create({
      data: { userId: clientUserId }
    });

    const specialist = await db.specialist.create({
      data: { userId: specialistUserId }
    });

    const category = await db.category.create({
      data: {
        name: 'Categoría liquidacion751',
        slug: 'liquidacion751-' + suffix
      }
    });
    categoryId = category.id;

    const job = await db.jobRequest.create({
      data: {
        clientId: client.id,
        categoryId,
        title: 'Trabajo liquidacion751',
        description: 'Prueba ficticia de concurrencia',
        city: 'Chicago',
        state: 'IL',
        status: 'TERMINATION_REQUESTED'
      }
    });
    jobId = job.id;

    const proposal = await db.proposal.create({
      data: {
        jobRequestId: jobId,
        specialistId: specialist.id,
        amount: '150.00',
        status: 'ACCEPTED'
      }
    });

    const payment = await db.payment.create({
      data: {
        jobRequestId: jobId,
        proposalId: proposal.id,
        clientId: client.id,
        specialistId: specialist.id,
        amount: '150.00',
        status: 'PAID',
        provider: 'INTERNAL_MVP'
      }
    });

    await db.terminationRequest.create({
      data: {
        jobRequestId: jobId,
        requestedById: clientUserId,
        requesterRole: 'CLIENT',
        jobStatusAtRequest: 'ASSIGNED',
        reasonCode: 'TEST_CONCURRENCY',
        status: 'PENDING'
      }
    });

    const request = {
      user: { userId: specialistUserId }
    };

    const results = await Promise.allSettled([
      controller(first).acceptTermination(request, jobId),
      controller(second).acceptTermination(request, jobId)
    ]);

    const successes = results.filter(
      result => result.status === 'fulfilled'
    );

    const failures = results.filter(
      result => result.status === 'rejected'
    );

    assert.equal(successes.length, 1);
    assert.equal(failures.length, 1);

    const finalPayment = await db.payment.findUnique({
      where: { id: payment.id }
    });

    const movements = await db.paymentMovement.findMany({
      where: { paymentId: payment.id }
    });

    const termination = await db.terminationRequest.findUnique({
      where: { jobRequestId: jobId }
    });

    assert.equal(finalPayment.status, 'SETTLED');
    assert.equal(termination.status, 'RESOLVED');
    assert.equal(movements.length, 2);

    const payout = movements.find(
      movement => movement.type === 'SPECIALIST_PAYOUT'
    );

    const refund = movements.find(
      movement => movement.type === 'CLIENT_REFUND'
    );

    assert.equal(Number(payout.amount), 15);
    assert.equal(Number(refund.amount), 135);

    console.log(
      'CORRECTO - Dos solicitudes; una liquidación exitosa'
    );
    console.log(
      'CORRECTO - Dos movimientos únicos: $15 y $135'
    );

  } finally {
    try {
      if (jobId) {
        // Eliminar dependencias económicas antes de sus padres.
        await db.paymentMovement.deleteMany({
          where: { payment: { jobRequestId: jobId } }
        });
        await db.payment.deleteMany({
          where: { jobRequestId: jobId }
        });
        await db.terminationRequest.deleteMany({
          where: { jobRequestId: jobId }
        });
        await db.workOrder.deleteMany({
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

      if (specialistUserId) {
        await db.specialist.deleteMany({
          where: { userId: specialistUserId }
        });
        await db.user.deleteMany({
          where: { id: specialistUserId }
        });
      }

      if (clientUserId) {
        await db.client.deleteMany({
          where: { userId: clientUserId }
        });
        await db.user.deleteMany({
          where: { id: clientUserId }
        });
      }
    } finally {
      await Promise.all([
        db.$disconnect(),
        first.$disconnect(),
        second.$disconnect()
      ]);
    }
  }
});
