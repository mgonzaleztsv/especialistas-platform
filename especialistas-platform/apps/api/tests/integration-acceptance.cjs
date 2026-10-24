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

  const prisma = new PrismaClient();

  try {
    const db = await prisma.$queryRaw`
      SELECT current_database() AS name
    `;
    assert.equal(db[0].name, 'connectpro_test');

    const client = await prisma.user.findUnique({
      where: {
        email: 'cliente.integration@connectpro.test'
      }
    });

    const specialist = await prisma.user.findUnique({
      where: {
        email: 'especialista.integration@connectpro.test'
      }
    });

    assert.ok(client);
    assert.ok(specialist);

    const job = await prisma.jobRequest.findFirst({
      where: {
        title: 'PRUEBA INTEGRAL CONNECTPRO 395'
      },
      include: {
        workOrders: true,
        payment: true
      }
    });

    assert.ok(job);
    assert.equal(job.status, 'PENDING_AGREEMENT');
    assert.equal(job.workOrders.length, 1);
    assert.equal(job.payment, null);

    const order = job.workOrders[0];

    assert.equal(order.status, 'PENDING_ACCEPTANCE');
    assert.equal(order.clientAcceptedAt, null);
    assert.equal(order.specialistAcceptedAt, null);

    const controller = new JobRequestsController(prisma);

    // Primera aceptación: cliente
    await controller.acceptWorkOrder(
      { user: { userId: client.id } },
      job.id
    );

    const afterClient = await prisma.workOrder.findUnique({
      where: { id: order.id }
    });

    assert.ok(afterClient.clientAcceptedAt);
    assert.equal(afterClient.specialistAcceptedAt, null);
    assert.equal(afterClient.status, 'PENDING_ACCEPTANCE');

    console.log('CORRECTO - Cliente aceptó la orden');

    // Segunda aceptación: especialista
    await controller.acceptWorkOrder(
      { user: { userId: specialist.id } },
      job.id
    );

    const updated = await prisma.jobRequest.findUnique({
      where: { id: job.id },
      include: {
        workOrders: true,
        proposals: true,
        payment: true
      }
    });

    const accepted = updated.workOrders[0];

    assert.equal(accepted.status, 'ACCEPTED');
    assert.ok(accepted.clientAcceptedAt);
    assert.ok(accepted.specialistAcceptedAt);

    console.log('CORRECTO - Ambas partes aceptaron');

    assert.equal(updated.proposals[0].status, 'ACCEPTED');
    console.log('CORRECTO - Propuesta aceptada');

    assert.equal(updated.status, 'AWAITING_PAYMENT');
    console.log('CORRECTO - Solicitud espera pago');

    assert.ok(updated.payment);
    assert.equal(updated.payment.status, 'PENDING');
    assert.equal(Number(updated.payment.amount), 175);
    assert.equal(updated.payment.currency, 'USD');

    console.log('CORRECTO - Pago pendiente de $175 USD');
    console.log('PASO 399 COMPLETADO');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('ERROR:', error.message);
  process.exitCode = 1;
});
