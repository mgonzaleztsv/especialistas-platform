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

    assert.ok(job, 'No se encontró el trabajo ficticio');
    assert.equal(job.status, 'AWAITING_CLIENT_CONFIRMATION');
    assert.ok(job.payment);
    assert.equal(job.payment.status, 'PAID');
    assert.equal(job.payment.provider, 'INTERNAL_MVP');
    assert.equal(Number(job.payment.amount), 175);

    const controller = new JobRequestsController(prisma);
    const request = { user: { userId: client.id } };

    await controller.confirmJobCompletion(request, job.id);

    const updated = await prisma.jobRequest.findUnique({
      where: { id: job.id },
      include: { payment: true }
    });

    assert.equal(updated.status, 'COMPLETED');
    console.log('CORRECTO - Trabajo completado');

    assert.equal(updated.payment.status, 'RELEASED');
    console.log('CORRECTO - Pago simulado liberado');

    assert.ok(updated.payment.releasedAt instanceof Date);
    assert.equal(Number(updated.payment.amount), 175);
    console.log('CORRECTO - Fecha e importe conservados');

    await assert.rejects(
      controller.confirmJobCompletion(request, job.id)
    );
    console.log('CORRECTO - Segunda confirmación rechazada');

    const finalJob = await prisma.jobRequest.findUnique({
      where: { id: job.id },
      include: { payment: true }
    });

    assert.equal(finalJob.status, 'COMPLETED');
    assert.equal(finalJob.payment.status, 'RELEASED');

    console.log('CORRECTO - Estados finales conservados');
    console.log('PASO 403 COMPLETADO');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('ERROR:', error.message);
  process.exitCode = 1;
});
