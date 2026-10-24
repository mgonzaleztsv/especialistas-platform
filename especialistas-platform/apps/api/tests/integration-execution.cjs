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

    const specialist = await prisma.user.findUnique({
      where: {
        email: 'especialista.integration@connectpro.test'
      },
      include: { specialist: true }
    });

    assert.ok(specialist?.specialist);

    const job = await prisma.jobRequest.findFirst({
      where: {
        title: 'PRUEBA INTEGRAL CONNECTPRO 395',
        proposals: {
          some: {
            specialistId: specialist.specialist.id,
            status: 'ACCEPTED'
          }
        }
      },
      include: { payment: true }
    });

    assert.ok(job, 'Trabajo de prueba no encontrado');
    assert.equal(job.status, 'ASSIGNED');
    assert.equal(job.payment?.status, 'PAID');
    assert.equal(job.payment?.provider, 'INTERNAL_MVP');
    assert.equal(Number(job.payment.amount), 175);

    const controller = new JobRequestsController(prisma);
    const request = { user: { userId: specialist.id } };

    await controller.startSpecialistJob(request, job.id);

    const started = await prisma.jobRequest.findUnique({
      where: { id: job.id }
    });

    assert.equal(started.status, 'IN_PROGRESS');
    console.log('CORRECTO - Especialista inició el trabajo');

    await assert.rejects(
      controller.startSpecialistJob(request, job.id)
    );
    console.log('CORRECTO - Segundo inicio rechazado');

    await controller.completeSpecialistJob(request, job.id);

    const completed = await prisma.jobRequest.findUnique({
      where: { id: job.id },
      include: { payment: true }
    });

    assert.equal(
      completed.status,
      'AWAITING_CLIENT_CONFIRMATION'
    );
    console.log('CORRECTO - Especialista terminó el trabajo');

    assert.equal(completed.payment.status, 'PAID');
    console.log('CORRECTO - Pago permanece pendiente de liberación');

    await assert.rejects(
      controller.completeSpecialistJob(request, job.id)
    );
    console.log('CORRECTO - Segunda finalización rechazada');

    console.log('PASO 402 COMPLETADO');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('ERROR:', error.message);
  process.exitCode = 1;
});
