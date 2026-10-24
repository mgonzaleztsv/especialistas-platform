const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { URL } = require('node:url');

const { JobRequestsController } = require(
  '../dist/job-requests/job-requests.controller.js'
);

async function main() {
  const url = new URL(process.env.DATABASE_URL || '');

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

    const specialist = await prisma.user.findUnique({
      where: {
        email: 'especialista.integration@connectpro.test'
      },
      include: { specialist: true }
    });

    const category = await prisma.category.findUnique({
      where: { slug: 'plomeria' }
    });

    assert.ok(client?.client);
    assert.ok(specialist?.specialist);
    assert.ok(category);

    const existing = await prisma.jobRequest.findFirst({
      where: {
        clientId: client.client.id,
        title: 'PRUEBA INTEGRAL CONNECTPRO 395'
      }
    });

    if (existing) {
      throw new Error(
        'Ya existe el trabajo de prueba 395. ' +
        'No se crearán duplicados.'
      );
    }

    const controller = new JobRequestsController(prisma);

    const clientRequest = {
      user: { userId: client.id }
    };

    const specialistRequest = {
      user: { userId: specialist.id }
    };

    const job = await controller.create(clientRequest, {
      categoryId: category.id,
      title: 'PRUEBA INTEGRAL CONNECTPRO 395',
      description: 'Reparación ficticia de una llave de agua',
      budgetMin: 100,
      budgetMax: 200,
      city: 'Chicago',
      state: 'IL',
      zipcode: '60601'
    });

    assert.equal(job.status, 'PUBLISHED');
    console.log('CORRECTO - Trabajo publicado');

    const proposal = await controller.createProposal(
      specialistRequest,
      job.id,
      {
        amount: 150,
        materialsAmount: 25,
        includedScope: 'Reparación de llave de agua',
        excludedScope: 'Reparaciones adicionales',
        message: 'Propuesta ficticia de prueba'
      }
    );

    assert.equal(proposal.status, 'PENDING');
    console.log('CORRECTO - Propuesta creada');

    const updated = await prisma.jobRequest.findUnique({
      where: { id: job.id }
    });

    assert.equal(updated.status, 'RECEIVING_QUOTES');
    console.log('CORRECTO - Solicitud recibe cotizaciones');

    console.log('PRUEBA 395 COMPLETADA');
    console.log('Base utilizada: connectpro_test');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('ERROR:', error.message);
  process.exitCode = 1;
});
