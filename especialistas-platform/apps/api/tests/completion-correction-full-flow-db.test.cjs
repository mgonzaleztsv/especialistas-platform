const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

function verificarBase() {
  const url = new URL(process.env.DATABASE_URL || '');

  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.equal(url.port, '5433');
  assert.equal(url.pathname, '/connectpro_test');
  assert.equal(decodeURIComponent(url.username), 'connectpro_test');
  assert.equal(url.searchParams.get('schema') || 'public', 'public');
}

function crearControlador(prisma) {
  const controller = Object.create(
    JobRequestsController.prototype
  );

  controller.prisma = prisma;
  controller.retryTransaction = async fn => fn();

  return controller;
}

async function verificarEscenario(action, horas) {
  verificarBase();

  const db = new PrismaClient();
  const marker = randomUUID().replace(/-/g, '').slice(0, 16);

  let clientUserId = null;
  let specialistUserId = null;
  let clientId = null;
  let specialistId = null;
  let categoryId = null;
  let jobId = null;
  let paymentId = null;

  try {
    await db.$connect();

    const clientUser = await db.user.create({
      data: {
        name: 'Cliente prueba 904',
        email: `cliente904-${marker}@example.invalid`,
        passwordHash: 'TEST_ONLY',
        role: 'CLIENT'
      }
    });
    clientUserId = clientUser.id;

    const specialistUser = await db.user.create({
      data: {
        name: 'Especialista prueba 904',
        email: `especialista904-${marker}@example.invalid`,
        passwordHash: 'TEST_ONLY',
        role: 'SPECIALIST'
      }
    });
    specialistUserId = specialistUser.id;

    const client = await db.client.create({
      data: { userId: clientUserId }
    });
    clientId = client.id;

    const specialist = await db.specialist.create({
      data: { userId: specialistUserId }
    });
    specialistId = specialist.id;

    const category = await db.category.create({
      data: {
        name: `Categoría prueba 904 ${marker}`,
        slug: `categoria-904-${marker}`
      }
    });
    categoryId = category.id;

    const job = await db.jobRequest.create({
      data: {
        clientId,
        categoryId,
        title: 'Trabajo temporal de corrección',
        description: 'Prueba integral del procedimiento',
        city: 'Chicago',
        state: 'IL',
        status: 'AWAITING_CLIENT_CONFIRMATION',
        reviewPeriodHours: horas,
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
    paymentId = payment.id;

    const claim = await db.completionClaim.create({
      data: {
        jobRequestId: jobId,
        clientId,
        description: 'La reparación presenta defectos',
        status: 'PENDING'
      }
    });

    const controller = crearControlador(db);

    // 1. El especialista acepta realizar las correcciones.

    const response = await controller.respondCompletionClaim(
      { user: { userId: specialistUserId } },
      jobId,
      claim.id,
      {
        action: 'ACCEPT_CORRECTION',
        notes: 'Acepto corregir los defectos señalados.'
      }
    );

    assert.equal(response.status, 'CORRECTION_REQUESTED');

    // 2. El especialista comunica que terminó.

    const finished = await controller.completeCorrectionBySpecialist(
      { user: { userId: specialistUserId } },
      jobId,
      claim.id,
      {
        notes: 'Se realizaron las correcciones solicitadas.'
      }
    );

    assert.equal(finished.status, 'CORRECTION_REQUESTED');

    assert.ok(finished.correctionCompletedAt instanceof Date);
    assert.ok(finished.correctionReviewDeadline instanceof Date);

    const diferencia =
      finished.correctionReviewDeadline.getTime() -
      finished.correctionCompletedAt.getTime();

    assert.equal(diferencia, horas * 60 * 60 * 1000);

    // 3. No puede volver a comunicar la misma corrección.

    await assert.rejects(
      controller.completeCorrectionBySpecialist(
        { user: { userId: specialistUserId } },
        jobId,
        claim.id,
        {
          notes: 'Intento duplicado de notificación.'
        }
      ),
      e => e.status === 409
    );

    // 4. El cliente acepta o disputa las correcciones.

    const notes = action === 'ACCEPT'
      ? 'Las correcciones quedaron satisfactorias.'
      : 'Los defectos todavía persisten después de corregir.';

    const review = await controller.reviewCompletedCorrectionByClient(
      { user: { userId: clientUserId } },
      jobId,
      claim.id,
      { action, notes }
    );

    const expectedStatus =
      action === 'ACCEPT' ? 'RESOLVED' : 'DISPUTED';

    assert.equal(review.status, expectedStatus);

    // 5. La segunda revisión no puede duplicarse.

    await assert.rejects(
      controller.reviewCompletedCorrectionByClient(
        { user: { userId: clientUserId } },
        jobId,
        claim.id,
        { action, notes }
      ),
      e => e.status === 409
    );

    // 6. Comprobar el historial persistido en PostgreSQL.

    const finalClaim = await db.completionClaim.findUniqueOrThrow({
      where: { id: claim.id }
    });

    assert.equal(finalClaim.status, expectedStatus);

    assert.ok(finalClaim.specialistRespondedAt instanceof Date);
    assert.ok(finalClaim.correctionCompletedAt instanceof Date);
    assert.ok(finalClaim.correctionReviewDeadline instanceof Date);
    assert.ok(finalClaim.clientCorrectionRespondedAt instanceof Date);

    assert.equal(
      finalClaim.correctionCompletionNotes,
      'Se realizaron las correcciones solicitadas.'
    );

    assert.equal(
      finalClaim.clientCorrectionResponseNotes,
      notes
    );

    if (action === 'ACCEPT') {
      assert.ok(
        finalClaim.clientCorrectionAcceptedAt instanceof Date
      );
    } else {
      assert.equal(
        finalClaim.clientCorrectionAcceptedAt,
        null
      );
    }

    // 7. Comprobar que no se alteraron los fondos.

    const finalPayment = await db.payment.findUniqueOrThrow({
      where: { id: paymentId }
    });

    const finalJob = await db.jobRequest.findUniqueOrThrow({
      where: { id: jobId }
    });

    const movements = await db.paymentMovement.count({
      where: { paymentId }
    });

    assert.equal(finalPayment.status, 'PAID');
    assert.equal(finalPayment.releasedAt, null);
    assert.equal(finalJob.status, 'AWAITING_CLIENT_CONFIRMATION');
    assert.equal(movements, 0);

    console.log(
      `CORRECTO - ${action}, revisión de ${horas} horas`
    );
    console.log('CORRECTO - Historial conservado');
    console.log('CORRECTO - Respuestas duplicadas bloqueadas');
    console.log('CORRECTO - Sin modificaciones financieras');

  } finally {
    try {
      if (jobId) {
        await db.completionClaim.deleteMany({
          where: { jobRequestId: jobId }
        });

        await db.paymentMovement.deleteMany({
          where: {
            payment: { jobRequestId: jobId }
          }
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
              in: [
                clientUserId,
                specialistUserId
              ].filter(Boolean)
            }
          }
        });
      }
    } finally {
      await db.$disconnect();
    }
  }
}

test('904.1 - Corrección aceptada, plazo de 48 horas', async () => {
  await verificarEscenario('ACCEPT', 48);
});

test('904.2 - Corrección disputada, plazo de 168 horas', async () => {
  await verificarEscenario('DISPUTE', 168);
});
