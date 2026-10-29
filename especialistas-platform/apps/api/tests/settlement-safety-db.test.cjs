
const test = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');

const ROLLBACK = 'SETTLEMENT_TEST_ROLLBACK_747';

function checkUrl() {
  const url = new URL(process.env.DATABASE_URL || '');
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.equal(url.port, '5433');
  assert.equal(url.pathname, '/connectpro_test');
}

test('747.1 - Una liquidación no puede repetirse', async () => {
  checkUrl();

  const prisma = new PrismaClient();

  try {
    await prisma.$connect();

    await assert.rejects(
      prisma.$transaction(async tx => {
        const user = await tx.user.create({
          data: {
            name: 'Cliente prueba 747',
            email: 'cliente747@example.invalid',
            passwordHash: 'TEST_ONLY',
            role: 'CLIENT'
          }
        });

        const specialistUser = await tx.user.create({
          data: {
            name: 'Especialista prueba 747',
            email: 'especialista747@example.invalid',
            passwordHash: 'TEST_ONLY',
            role: 'SPECIALIST'
          }
        });

        const client = await tx.client.create({
          data: { userId: user.id }
        });

        const specialist = await tx.specialist.create({
          data: { userId: specialistUser.id }
        });

        const category = await tx.category.create({
          data: {
            name: 'Categoría 747',
            slug: 'categoria-747'
          }
        });

        const job = await tx.jobRequest.create({
          data: {
            clientId: client.id,
            categoryId: category.id,
            title: 'Liquidación ficticia',
            description: 'Prueba de pago único',
            city: 'Chicago',
            state: 'IL'
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

        const first = await tx.payment.updateMany({
          where: {
            id: payment.id,
            status: 'PAID'
          },
          data: { status: 'SETTLED' }
        });

        assert.equal(first.count, 1);

        await tx.paymentMovement.create({
          data: {
            paymentId: payment.id,
            type: 'SPECIALIST_PAYOUT',
            amount: '150.00',
            description: 'Liquidación ficticia 747'
          }
        });

        const second = await tx.payment.updateMany({
          where: {
            id: payment.id,
            status: 'PAID'
          },
          data: { status: 'SETTLED' }
        });

        assert.equal(second.count, 0);

        const movements = await tx.paymentMovement.findMany({
          where: { paymentId: payment.id }
        });

        assert.equal(movements.length, 1);

        console.log('CORRECTO - Primera liquidación registrada');
        console.log('CORRECTO - Segunda liquidación rechazada');
        console.log('CORRECTO - Sin movimientos duplicados');

        throw new Error(ROLLBACK);
      }),
      error => error.message === ROLLBACK
    );

    assert.equal(await prisma.payment.count(), 0);
    assert.equal(await prisma.paymentMovement.count(), 0);

    console.log('CORRECTO - Registros económicos revertidos');

  } finally {
    await prisma.$disconnect();
  }
});
