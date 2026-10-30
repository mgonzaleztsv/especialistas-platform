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
}

function controlador(db) {
  const c = Object.create(JobRequestsController.prototype);
  c.prisma = db;
  return c;
}

for (const decision of ['RESOLVED', 'REJECTED']) {
  test(
    `889 - ${decision}: resolución concurrente no libera fondos`,
    async () => {
      verificarBase();

      const db = new PrismaClient();
      const adminDb = new PrismaClient();
      const clientDb = new PrismaClient();

      const marker = randomUUID().slice(0, 12);

      let clientUserId = null;
      let specialistUserId = null;
      let clientId = null;
      let specialistId = null;
      let categoryId = null;
      let jobId = null;
      let paymentId = null;
      let claimId = null;

      const previous = process.env.INTERNAL_MVP_PAYMENTS_ENABLED;

      try {
        await db.$connect();

        const clientUser = await db.user.create({
          data: {
            name: 'Cliente prueba 889',
            email: `cliente889-${marker}@example.invalid`,
            passwordHash: 'TEST_ONLY',
            role: 'CLIENT'
          }
        });
        clientUserId = clientUser.id;

        const specialistUser = await db.user.create({
          data: {
            name: 'Especialista prueba 889',
            email: `especialista889-${marker}@example.invalid`,
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
            name: `Categoría prueba 889 ${marker}`,
            slug: `categoria-889-${marker}`
          }
        });
        categoryId = category.id;

        const job = await db.jobRequest.create({
          data: {
            clientId,
            categoryId,
            title: 'Trabajo temporal de concurrencia 889',
            description: 'Comprobar resolución y confirmación simultáneas',
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
        paymentId = payment.id;

        const claim = await db.completionClaim.create({
          data: {
            jobRequestId: jobId,
            clientId,
            description: 'Reclamación temporal de prueba',
            status: 'DISPUTED',
            specialistResponseNotes: 'Respuesta de prueba',
            specialistRespondedAt: new Date()
          }
        });
        claimId = claim.id;

        const admin = controlador(adminDb);
        const customer = controlador(clientDb);

        // Habilitado únicamente dentro del proceso de prueba.
        // No modifica servidores ni variables persistentes.
        process.env.INTERNAL_MVP_PAYMENTS_ENABLED = 'true';

        const resultados = await Promise.allSettled([
          admin.resolveCompletionClaimByAdmin(
            jobId,
            claimId,
            {
              decision,
              resolutionNotes:
                'Resolución de prueba para verificar concurrencia'
            }
          ),
          customer.confirmJobCompletion(
            { user: { userId: clientUserId } },
            jobId
          )
        ]);

        assert.equal(
          resultados[0].status,
          'fulfilled',
          'La resolución administrativa debe poder registrarse'
        );

        assert.equal(
          resultados[1].status,
          'rejected',
          'La confirmación no debe liberar el pago'
        );

        const finalClaim = await db.completionClaim.findUniqueOrThrow({
          where: { id: claimId }
        });

        const finalPayment = await db.payment.findUniqueOrThrow({
          where: { id: paymentId }
        });

        const finalJob = await db.jobRequest.findUniqueOrThrow({
          where: { id: jobId }
        });

        assert.equal(finalClaim.status, decision);
        assert.ok(finalClaim.resolvedAt instanceof Date);

        assert.equal(finalPayment.status, 'PAID');
        assert.equal(finalPayment.releasedAt, null);

        assert.equal(
          finalJob.status,
          'AWAITING_CLIENT_CONFIRMATION'
        );

        const movements = await db.paymentMovement.count({
          where: { paymentId }
        });

        assert.equal(movements, 0);

        // Segunda comprobación: incluso una vez cerrada
        // la reclamación, el cliente no puede liberar el pago.
        await assert.rejects(
          customer.confirmJobCompletion(
            { user: { userId: clientUserId } },
            jobId
          ),
          error =>
            error.status === 409 &&
            /autorización financiera independiente/i.test(error.message)
        );

        const paymentAfter = await db.payment.findUniqueOrThrow({
          where: { id: paymentId }
        });

        assert.equal(paymentAfter.status, 'PAID');
        assert.equal(paymentAfter.releasedAt, null);

        console.log(`CORRECTO - Reclamación ${decision}`);
        console.log('CORRECTO - Confirmación concurrente rechazada');
        console.log('CORRECTO - Pago conservó estado PAID');
        console.log('CORRECTO - Sin movimientos financieros');
        console.log('CORRECTO - Confirmación posterior bloqueada');

      } finally {
        if (previous === undefined) {
          delete process.env.INTERNAL_MVP_PAYMENTS_ENABLED;
        } else {
          process.env.INTERNAL_MVP_PAYMENTS_ENABLED = previous;
        }

        try {
          await adminDb.$disconnect();
          await clientDb.$disconnect();

          if (paymentId) {
            await db.paymentMovement.deleteMany({
              where: { paymentId }
            });
          }

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
    }
  );
}
