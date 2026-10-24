'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { URL } = require('node:url');
const { PrismaClient } = require('@prisma/client');
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
    process.env.INTERNAL_MVP_PAYMENTS_ENABLED, 'true'
  );
  assert.equal(
    process.env.WORK_ORDER_EXPIRATION_ENABLED, 'false'
  );

  const prisma = new PrismaClient();

  try {
    const db = await prisma.$queryRaw`
      SELECT current_database() AS name
    `;
    assert.equal(db[0].name, 'connectpro_test');

    const client = await prisma.user.findUnique({
      where: { email: 'cliente.integration@connectpro.test' },
      include: { client: true }
    });
    const specialist = await prisma.user.findUnique({
      where: { email: 'especialista.integration@connectpro.test' },
      include: { specialist: true }
    });
    const category = await prisma.category.findFirst();

    assert.ok(client?.client);
    assert.ok(specialist?.specialist);
    assert.ok(category);

    const controller = new JobRequestsController(prisma);
    const clientReq = { user: { userId: client.id } };
    const specialistReq = { user: { userId: specialist.id } };

    const job = await controller.create(clientReq, {
      title: 'PRUEBA CONCURRENCIA ' + randomUUID(),
      description: 'Trabajo ficticio de seguridad',
      categoryId: category.id,
      city: 'Chicago',
      state: 'IL',
      zipcode: '60601'
    });

    console.log('ESCENARIO:', job.id);

    const proposal = await controller.createProposal(
      specialistReq, job.id, {
        amount: 150,
        materialsAmount: 25,
        includedScope: 'Trabajo ficticio',
        excludedScope: 'Otros trabajos',
        message: 'Prueba de concurrencia'
      }
    );

    await controller.acceptProposal(
      clientReq, job.id, proposal.id
    );
    await controller.acceptWorkOrder(clientReq, job.id);
    await controller.acceptWorkOrder(specialistReq, job.id);
    await controller.confirmPayment(clientReq, job.id);

    const before = await prisma.jobRequest.findUnique({
      where: { id: job.id },
      include: { payment: true }
    });

    assert.equal(before.status, 'ASSIGNED');
    assert.equal(before.payment.status, 'PAID');

    const starts = await Promise.allSettled([
      controller.startSpecialistJob(specialistReq, job.id),
      controller.startSpecialistJob(specialistReq, job.id)
    ]);

    assert.equal(
      starts.filter(x => x.status === 'fulfilled').length, 1,
      'Solamente un inicio debe completarse'
    );
    assert.equal(
      starts.filter(x => x.status === 'rejected').length, 1,
      'El otro inicio debe rechazarse'
    );

    const started = await prisma.jobRequest.findUnique({
      where: { id: job.id }
    });

    assert.equal(started.status, 'IN_PROGRESS');
    console.log('CORRECTO - Un solo inicio autorizado');

    const completions = await Promise.allSettled([
      controller.completeSpecialistJob(specialistReq, job.id),
      controller.completeSpecialistJob(specialistReq, job.id)
    ]);

    assert.equal(
      completions.filter(x => x.status === 'fulfilled').length, 1,
      'Solamente una finalización debe completarse'
    );
    assert.equal(
      completions.filter(x => x.status === 'rejected').length, 1,
      'La otra finalización debe rechazarse'
    );

    const completed = await prisma.jobRequest.findUnique({
      where: { id: job.id },
      include: { payment: true }
    });

    assert.equal(
      completed.status,
      'AWAITING_CLIENT_CONFIRMATION'
    );
    assert.equal(completed.payment.status, 'PAID');

    console.log('CORRECTO - Una sola finalización autorizada');
    console.log('CORRECTO - Pago continúa sin liberar');
    console.log('===== PASO 425 COMPLETADO =====');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('ERROR:', error.message);
  process.exitCode = 1;
});
