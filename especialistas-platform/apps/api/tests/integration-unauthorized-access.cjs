'use strict';

const assert = require('node:assert/strict');
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

  const prisma = new PrismaClient();

  try {
    const db = await prisma.$queryRaw`
      SELECT current_database() AS name
    `;
    assert.equal(db[0].name, 'connectpro_test');

    const outsider = await prisma.user.findUnique({
      where: {
        email: 'cliente.ajeno@connectpro.test'
      },
      include: { client: true }
    });

    assert.ok(outsider?.client);

    const jobId = 'b0e9828b-b293-47a5-93fe-468c6d289f80';

    const job = await prisma.jobRequest.findUnique({
      where: { id: jobId },
      include: {
        client: true,
        proposals: {
          where: { status: 'ACCEPTED' },
          include: { specialist: true }
        },
        workOrders: true
      }
    });

    assert.ok(job);
    assert.equal(job.proposals.length, 1);
    assert.ok(job.workOrders.length > 0);

    assert.notEqual(job.client.userId, outsider.id);
    assert.notEqual(
      job.proposals[0].specialist.userId,
      outsider.id
    );

    const controller = new JobRequestsController(prisma);
    const req = { user: { userId: outsider.id } };

    const before = await prisma.message.count({
      where: { jobRequestId: jobId }
    });

    const operations = [
      [
        'Consultar propuestas',
        () => controller.getProposals(req, jobId)
      ],
      [
        'Consultar Orden de Trabajo',
        () => controller.getWorkOrder(req, jobId)
      ],
      [
        'Consultar historial',
        () => controller.getWorkOrderHistory(req, jobId)
      ],
      [
        'Leer mensajes',
        () => controller.getJobMessages(req, jobId)
      ],
      [
        'Enviar mensaje',
        () => controller.sendJobMessage(
          req,
          jobId,
          { body: 'MENSAJE NO AUTORIZADO DE PRUEBA' }
        )
      ]
    ];

    let passed = 0;

    for (const [name, operation] of operations) {
      await assert.rejects(
        operation(),
        /no pertenece|no tienes acceso|no existe/i
      );
      console.log('CORRECTO - Acceso rechazado:', name);
      passed++;
    }

    const after = await prisma.message.count({
      where: { jobRequestId: jobId }
    });

    assert.equal(after, before);
    console.log('CORRECTO - No se creó ningún mensaje');

    assert.equal(passed, 5);
    console.log('===== PASO 431 COMPLETADO =====');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('ERROR:', error.message);
  process.exitCode = 1;
});
