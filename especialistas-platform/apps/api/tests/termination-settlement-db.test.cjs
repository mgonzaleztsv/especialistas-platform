
const test = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

const ROLLBACK = 'ROLLBACK_TERMINATION_750';

function verifyEnvironment() {
  const parsed = new URL(process.env.DATABASE_URL || '');
  assert.ok(['postgres:', 'postgresql:'].includes(parsed.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(parsed.hostname));
  assert.equal(parsed.port, '5433');
  assert.equal(parsed.pathname, '/connectpro_test');
  assert.notEqual(process.env.INTERNAL_MVP_PAYMENTS_ENABLED, 'true');
}

test('750.1 - Liquidación única mediante controlador real', async () => {
  verifyEnvironment();

  const prisma = new PrismaClient();

  try {
    await prisma.$connect();

    assert.equal(await prisma.payment.count(), 0);
    assert.equal(await prisma.paymentMovement.count(), 0);

    await assert.rejects(
      prisma.$transaction(async tx => {
        const clientUser = await tx.user.create({
          data: {
            name: 'Cliente prueba 750',
            email: 'cliente750@example.invalid',
            passwordHash: 'TEST_ONLY',
            role: 'CLIENT'
          }
        });

        const specialistUser = await tx.user.create({
          data: {
            name: 'Especialista prueba 750',
            email: 'especialista750@example.invalid',
            passwordHash: 'TEST_ONLY',
            role: 'SPECIALIST'
          }
        });

        const client = await tx.client.create({
          data: { userId: clientUser.id }
        });

        const specialist = await tx.specialist.create({
          data: { userId: specialistUser.id }
        });

        const category = await tx.category.create({
          data: {
            name: 'Categoría 750',
            slug: 'categoria-750'
          }
        });

        const job = await tx.jobRequest.create({
          data: {
            clientId: client.id,
            categoryId: category.id,
            title: 'Trabajo ficticio 750',
            description: 'Prueba de terminación y liquidación',
            city: 'Chicago',
            state: 'IL',
            status: 'TERMINATION_REQUESTED'
          }
        });

        const proposal = await tx.proposal.create({
          data: {
            jobRequestId: job.id,
            specialistId: specialist.id,
            amount: '150.00',
            status: 'ACCEPTED'
          }
        });

        const payment = await tx.payment.create({
          data: {
            jobRequestId: job.id,
            proposalId: proposal.id,
            clientId: client.id,
            specialistId: specialist.id,
            amount: '150.00',
            status: 'PAID',
            provider: 'INTERNAL_MVP'
          }
        });

        const termination = await tx.terminationRequest.create({
          data: {
            jobRequestId: job.id,
            requestedById: clientUser.id,
            requesterRole: 'CLIENT',
            jobStatusAtRequest: 'ASSIGNED',
            reasonCode: 'TEST_TERMINATION',
            status: 'PENDING'
          }
        });

        // Adaptación de la transacción para poder revertir
        // todos los registros ficticios al finalizar.
        const controller = Object.create(
          JobRequestsController.prototype
        );

        controller.prisma = new Proxy(tx, {
          get(target, prop) {
            if (prop === '$transaction') {
              return async callback => callback(tx);
            }
            return Reflect.get(target, prop);
          }
        });

        const result = await controller.acceptTermination(
          { user: { userId: specialistUser.id } },
          job.id
        );

        assert.ok(result);

        const updatedPayment = await tx.payment.findUnique({
          where: { id: payment.id }
        });

        const updatedTermination =
          await tx.terminationRequest.findUnique({
            where: { id: termination.id }
          });

        const movements = await tx.paymentMovement.findMany({
          where: { paymentId: payment.id }
        });

        assert.equal(updatedPayment.status, 'SETTLED');
        assert.equal(updatedTermination.status, 'RESOLVED');
        assert.equal(movements.length, 2);

        const payout = movements.find(
          m => m.type === 'SPECIALIST_PAYOUT'
        );

        const refund = movements.find(
          m => m.type === 'CLIENT_REFUND'
        );

        assert.equal(Number(payout.amount), 15);
        assert.equal(Number(refund.amount), 135);

        console.log(
          'CORRECTO - Liquidación: $15 especialista, $135 cliente'
        );

        await assert.rejects(
          () => controller.acceptTermination(
            { user: { userId: specialistUser.id } },
            job.id
          )
        );

        assert.equal(
          await tx.paymentMovement.count({
            where: { paymentId: payment.id }
          }),
          2
        );

        console.log(
          'CORRECTO - Segundo intento rechazado sin duplicaciones'
        );

        throw new Error(ROLLBACK);
      }, { timeout: 30000 }),
      error => error.message === ROLLBACK
    );

    assert.equal(await prisma.payment.count(), 0);
    assert.equal(await prisma.paymentMovement.count(), 0);

    console.log('CORRECTO - Transacción revertida');

  } finally {
    await prisma.$disconnect();
  }
});
