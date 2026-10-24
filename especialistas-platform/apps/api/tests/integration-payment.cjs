const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { URL } = require('node:url');
const { JobRequestsController } = require(
  '../dist/job-requests/job-requests.controller.js'
);

async function main() {
  const url = new URL(process.env.DATABASE_URL || '');

  assert.equal(url.protocol, 'postgresql:');
  assert.equal(url.hostname, 'localhost');
  assert.equal(url.port, '5433');
  assert.equal(url.pathname, '/connectpro_test');
  assert.equal(url.username, 'connectpro_test');
  assert.equal(
    process.env.INTERNAL_MVP_PAYMENTS_ENABLED,
    'true'
  );
  assert.equal(
    process.env.WORK_ORDER_EXPIRATION_ENABLED,
    'false'
  );

  const prisma = new PrismaClient();

  try {
    const db = await prisma.$queryRaw`
      SELECT current_database() AS name
    `;
    assert.equal(db[0].name, 'connectpro_test');

    const client = await prisma.user.findUnique({
      where: {
        email: 'cliente.integration@connectpro.test'
      },
      include: { client: true }
    });

    assert.ok(client?.client);

    const job = await prisma.jobRequest.findFirst({
      where: {
        clientId: client.client.id,
        title: 'PRUEBA INTEGRAL CONNECTPRO 395'
      },
      include: { payment: true }
    });

    assert.ok(job);
    assert.equal(job.status, 'AWAITING_PAYMENT');
    assert.ok(job.payment);
    assert.equal(job.payment.status, 'PENDING');
    assert.equal(Number(job.payment.amount), 175);

    const controller = new JobRequestsController(prisma);
    const request = { user: { userId: client.id } };

    await controller.confirmPayment(request, job.id);

    const updated = await prisma.jobRequest.findUnique({
      where: { id: job.id },
      include: { payment: true }
    });

    assert.equal(updated.status, 'ASSIGNED');
    console.log('CORRECTO - Trabajo asignado');

    assert.equal(updated.payment.status, 'PAID');
    console.log('CORRECTO - Pago simulado confirmado');

    assert.equal(updated.payment.provider, 'INTERNAL_MVP');
    assert.ok(updated.payment.paidAt instanceof Date);
    console.log('CORRECTO - Proveedor interno y fecha registrados');

    assert.equal(Number(updated.payment.amount), 175);
    assert.equal(updated.payment.currency, 'USD');
    console.log('CORRECTO - Importe conservado: $175 USD');

    await assert.rejects(
      controller.confirmPayment(request, job.id)
    );

    const finalJob = await prisma.jobRequest.findUnique({
      where: { id: job.id },
      include: { payment: true }
    });

    assert.equal(finalJob.status, 'ASSIGNED');
    assert.equal(finalJob.payment.status, 'PAID');
    console.log('CORRECTO - Segunda confirmación rechazada');

    console.log('PASO 400 COMPLETADO');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('ERROR:', error.message);
  process.exitCode = 1;
});
