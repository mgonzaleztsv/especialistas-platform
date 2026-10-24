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
      },
      include: { client: true }
    });

    assert.ok(client?.client);

    const job = await prisma.jobRequest.findFirst({
      where: {
        clientId: client.client.id,
        title: 'PRUEBA INTEGRAL CONNECTPRO 395'
      },
      include: {
        proposals: true,
        workOrders: true
      }
    });

    assert.ok(job, 'No se encontró el trabajo de prueba');
    assert.equal(job.status, 'RECEIVING_QUOTES');
    assert.equal(job.proposals.length, 1);
    assert.equal(job.workOrders.length, 0);

    const proposal = job.proposals[0];
    assert.equal(proposal.status, 'PENDING');
    assert.equal(Number(proposal.amount), 150);
    assert.equal(Number(proposal.materialsAmount), 25);

    const controller = new JobRequestsController(prisma);

    await controller.acceptProposal(
      { user: { userId: client.id } },
      job.id,
      proposal.id
    );

    const updated = await prisma.jobRequest.findUnique({
      where: { id: job.id },
      include: {
        proposals: true,
        workOrders: true
      }
    });

    assert.equal(updated.status, 'PENDING_AGREEMENT');
    console.log('CORRECTO - Solicitud pendiente de acuerdo');

    assert.equal(updated.proposals[0].status, 'SELECTED');
    console.log('CORRECTO - Propuesta seleccionada');

    assert.equal(updated.workOrders.length, 1);

    const order = updated.workOrders[0];

    assert.equal(order.version, 1);
    assert.equal(order.status, 'PENDING_ACCEPTANCE');
    assert.equal(Number(order.laborAmount), 150);
    assert.equal(Number(order.materialsAmount), 25);
    assert.equal(order.respondingParty, 'CLIENT');
    assert.ok(order.negotiationId);

    console.log('CORRECTO - Orden de Trabajo versión 1');
    console.log('CORRECTO - Importe total: $175 USD');

    const hours = (
      order.responseDeadline.getTime() -
      order.createdAt.getTime()
    ) / 3600000;

    assert.ok(hours > 47.9 && hours < 48.1);

    console.log('CORRECTO - Plazo de aproximadamente 48 horas');
    console.log('PASO 397 COMPLETADO');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('ERROR:', error.message);
  process.exitCode = 1;
});
