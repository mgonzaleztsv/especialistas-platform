const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

test('826.1 - Respuestas reales y pago bloqueado', async () => {
  const url = new URL(process.env.DATABASE_URL || '');
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.equal(url.port, '5433');
  assert.equal(url.pathname, '/connectpro_test');

  const db = new PrismaClient();
  const marker = randomUUID().slice(0, 12);
  let clientUserId, specialistUserId, clientId, specialistId;
  let categoryId, jobId;

  try {
    await db.$connect();

    const clientUser = await db.user.create({
      data: {
        name: 'Cliente 826',
        email: `cliente826-${marker}@example.invalid`,
        passwordHash: 'TEST_ONLY',
        role: 'CLIENT'
      }
    });
    clientUserId = clientUser.id;

    const specialistUser = await db.user.create({
      data: {
        name: 'Especialista 826',
        email: `especialista826-${marker}@example.invalid`,
        passwordHash: 'TEST_ONLY',
        role: 'SPECIALIST'
      }
    });
    specialistUserId = specialistUser.id;

    clientId = (await db.client.create({
      data: { userId: clientUserId }
    })).id;

    specialistId = (await db.specialist.create({
      data: { userId: specialistUserId }
    })).id;

    categoryId = (await db.category.create({
      data: {
        name: `Categoría 826 ${marker}`,
        slug: `categoria-826-${marker}`
      }
    })).id;

    jobId = (await db.jobRequest.create({
      data: {
        clientId,
        categoryId,
        title: 'Trabajo ficticio 826',
        description: 'Prueba de respuesta del especialista',
        city: 'Chicago',
        state: 'IL',
        status: 'AWAITING_CLIENT_CONFIRMATION',
        reviewPeriodHours: 48,
        workCompletedAt: new Date(),
        reviewDeadline: new Date(Date.now() + 86400000)
      }
    })).id;

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

    const controller = Object.create(JobRequestsController.prototype);
    controller.prisma = db;
    controller.retryTransaction = async fn => fn();

    const specialistReq = {
      user: { userId: specialistUserId }
    };
    const clientReq = {
      user: { userId: clientUserId }
    };

    async function verifyBlocked() {
      const previous = process.env.INTERNAL_MVP_PAYMENTS_ENABLED;
      try {
        process.env.INTERNAL_MVP_PAYMENTS_ENABLED = 'true';
        await assert.rejects(
          controller.confirmJobCompletion(clientReq, jobId),
          error => error.status === 409
        );
      } finally {
        if (previous === undefined) {
          delete process.env.INTERNAL_MVP_PAYMENTS_ENABLED;
        } else {
          process.env.INTERNAL_MVP_PAYMENTS_ENABLED = previous;
        }
      }

      const paymentNow = await db.payment.findUniqueOrThrow({
        where: { id: payment.id }
      });
      const jobNow = await db.jobRequest.findUniqueOrThrow({
        where: { id: jobId }
      });

      assert.equal(paymentNow.status, 'PAID');
      assert.equal(paymentNow.releasedAt, null);
      assert.equal(jobNow.status, 'AWAITING_CLIENT_CONFIRMATION');
    }

    const firstClaim = await db.completionClaim.create({
      data: {
        jobRequestId: jobId,
        clientId,
        description: 'Existen defectos que requieren corrección',
        status: 'PENDING'
      }
    });

    const accepted = await controller.respondCompletionClaim(
      specialistReq,
      jobId,
      firstClaim.id,
      {
        action: 'ACCEPT_CORRECTION',
        notes: 'Acepto corregir los defectos identificados'
      }
    );

    assert.equal(accepted.status, 'CORRECTION_REQUESTED');
    assert.ok(accepted.specialistRespondedAt instanceof Date);
    assert.match(accepted.specialistResponseNotes, /Acepto corregir/);

    const stored = await db.completionClaim.findUniqueOrThrow({
      where: { id: firstClaim.id }
    });
    assert.equal(stored.status, 'CORRECTION_REQUESTED');
    assert.ok(stored.specialistRespondedAt);
    console.log('CORRECTO - Aceptación guardada en PostgreSQL');

    await assert.rejects(
      controller.respondCompletionClaim(
        specialistReq,
        jobId,
        firstClaim.id,
        {
          action: 'DISPUTE',
          notes: 'Intento de segunda respuesta no autorizado'
        }
      ),
      error => error.status === 409
    );

    console.log('CORRECTO - Respuesta duplicada rechazada');
    await verifyBlocked();
    console.log('CORRECTO - Corrección mantiene pago bloqueado');

    // Cierre ficticio de la primera reclamación para verificar
    // un segundo escenario sin violar el índice único parcial.
    await db.completionClaim.update({
      where: { id: firstClaim.id },
      data: {
        status: 'RESOLVED',
        resolutionNotes: 'Cierre exclusivo del escenario de prueba',
        resolvedAt: new Date()
      }
    });

    const secondClaim = await db.completionClaim.create({
      data: {
        jobRequestId: jobId,
        clientId,
        description: 'Segunda reclamación ficticia para desacuerdo',
        status: 'PENDING'
      }
    });

    const disputed = await controller.respondCompletionClaim(
      specialistReq,
      jobId,
      secondClaim.id,
      {
        action: 'DISPUTE',
        notes: 'No estoy de acuerdo con los defectos señalados'
      }
    );

    assert.equal(disputed.status, 'DISPUTED');
    assert.ok(disputed.specialistRespondedAt instanceof Date);
    console.log('CORRECTO - Desacuerdo guardado en PostgreSQL');

    await verifyBlocked();
    console.log('CORRECTO - Disputa mantiene pago bloqueado');

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
      if (clientUserId || specialistUserId) {
        await db.user.deleteMany({
          where: {
            id: {
              in: [clientUserId, specialistUserId].filter(Boolean)
            }
          }
        });
      }
    } finally {
      await db.$disconnect();
    }
  }
});
