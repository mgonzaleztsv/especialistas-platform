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
  let jobId = null;

  try {
    const database = await prisma.$queryRaw`
      SELECT current_database() AS name
    `;
    assert.equal(database[0].name, 'connectpro_test');

    const client = await prisma.user.findUnique({
      where: { email: 'cliente.integration@connectpro.test' },
      include: { client: true }
    });
    const specialist = await prisma.user.findUnique({
      where: { email: 'especialista.integration@connectpro.test' },
      include: { specialist: true }
    });

    assert.ok(client?.client);
    assert.ok(specialist?.specialist);

    const category = await prisma.category.findFirst();
    assert.ok(category);

    const controller = new JobRequestsController(prisma);
    const clientReq = { user: { userId: client.id } };
    const specialistReq = { user: { userId: specialist.id } };
    const title = 'PRUEBA AUTOMATIZADA ' + randomUUID();

    console.log('===== PRUEBA INTEGRAL CONNECTPRO =====');

    const job = await controller.create(clientReq, {
      title,
      description: 'Reparación ficticia de una llave de agua',
      categoryId: category.id,
      budgetMin: 500,
      budgetMax: 800,
      city: 'Chicago',
      state: 'IL',
      zipcode: '60601'
    });

    jobId = job.id;
    assert.equal(job.status, 'PUBLISHED');
    assert.equal(job.budgetMin, null);
    assert.equal(job.budgetMax, null);
    console.log('1. CORRECTO - Publicación sin presupuesto');

    const proposal = await controller.createProposal(
      specialistReq,
      job.id,
      {
        amount: 150,
        materialsAmount: 25,
        includedScope: 'Reparación de llave de agua',
        excludedScope: 'Reparaciones adicionales',
        message: 'Propuesta ficticia automatizada'
      }
    );

    assert.equal(proposal.status, 'PENDING');
    console.log('2. CORRECTO - Cotización del especialista');

    await controller.acceptProposal(
      clientReq, job.id, proposal.id
    );

    let current = await prisma.jobRequest.findUnique({
      where: { id: job.id },
      include: { workOrders: true, proposals: true }
    });

    assert.equal(current.status, 'PENDING_AGREEMENT');
    assert.equal(current.workOrders.length, 1);
    assert.equal(current.workOrders[0].status, 'PENDING_ACCEPTANCE');
    console.log('3. CORRECTO - Orden de Trabajo creada');

    await controller.acceptWorkOrder(clientReq, job.id);
    await controller.acceptWorkOrder(specialistReq, job.id);

    current = await prisma.jobRequest.findUnique({
      where: { id: job.id },
      include: { workOrders: true, payment: true }
    });

    assert.equal(current.status, 'AWAITING_PAYMENT');
    assert.equal(current.workOrders[0].status, 'ACCEPTED');
    assert.equal(current.payment.status, 'PENDING');
    assert.equal(Number(current.payment.amount), 175);
    console.log('4. CORRECTO - Acuerdo y pago pendiente');

    await controller.confirmPayment(clientReq, job.id);

    current = await prisma.jobRequest.findUnique({
      where: { id: job.id },
      include: { payment: true }
    });

    assert.equal(current.status, 'ASSIGNED');
    assert.equal(current.payment.status, 'PAID');
    assert.equal(current.payment.provider, 'INTERNAL_MVP');
    console.log('5. CORRECTO - Pago simulado confirmado');

    await controller.startSpecialistJob(specialistReq, job.id);

    current = await prisma.jobRequest.findUnique({
      where: { id: job.id }
    });
    assert.equal(current.status, 'IN_PROGRESS');
    console.log('6. CORRECTO - Trabajo iniciado');

    await controller.completeSpecialistJob(specialistReq, job.id);

    current = await prisma.jobRequest.findUnique({
      where: { id: job.id },
      include: { payment: true }
    });

    assert.equal(current.status, 'AWAITING_CLIENT_CONFIRMATION');
    assert.equal(current.payment.status, 'PAID');
    console.log('7. CORRECTO - Trabajo terminado');

    await controller.confirmJobCompletion(clientReq, job.id);

    current = await prisma.jobRequest.findUnique({
      where: { id: job.id },
      include: { payment: true }
    });

    assert.equal(current.status, 'COMPLETED');
    assert.equal(current.payment.status, 'RELEASED');
    assert.equal(current.payment.provider, 'INTERNAL_MVP');
    assert.equal(Number(current.payment.amount), 175);
    assert.ok(current.payment.releasedAt instanceof Date);
    console.log('8. CORRECTO - Pago simulado liberado');

    await assert.rejects(
      controller.confirmJobCompletion(clientReq, job.id)
    );

    const verified = await prisma.jobRequest.findUnique({
      where: { id: job.id },
      include: { payment: true }
    });

    assert.equal(verified.status, 'COMPLETED');
    assert.equal(verified.payment.status, 'RELEASED');
    console.log('9. CORRECTO - Doble confirmación rechazada');

    console.log('===== PRUEBA INTEGRAL SUPERADA =====');
    console.log('ID de prueba:', job.id);
  } catch (error) {
    if (jobId) {
      console.error('ID del escenario interrumpido:', jobId);
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('ERROR:', error.message);
  process.exitCode = 1;
});
