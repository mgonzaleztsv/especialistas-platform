const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { URL } = require('node:url');
const { PrismaClient } = require('@prisma/client');
const { JobRequestsController } = require(
  '../dist/job-requests/job-requests.controller.js'
);

async function main() {
  const parsed = new URL(process.env.DATABASE_URL || '');

  assert.equal(parsed.protocol, 'postgresql:');
  assert.equal(parsed.hostname, 'localhost');
  assert.equal(parsed.port, '5433');
  assert.equal(parsed.pathname, '/connectpro_test');
  assert.equal(parsed.username, 'connectpro_test');

  const prisma = new PrismaClient();

  try {
    const database = await prisma.$queryRaw`
      SELECT current_database() AS name
    `;
    assert.equal(database[0].name, 'connectpro_test');

    const user = await prisma.user.findUnique({
      where: { email: 'cliente.integration@connectpro.test' },
      include: { client: true }
    });
    assert.ok(user?.client);

    const category = await prisma.category.findFirst();
    assert.ok(category);

    const controller = new JobRequestsController(prisma);
    const req = { user: { userId: user.id } };
    const marker = randomUUID();

    const created = await controller.create(req, {
      title: `PRUEBA PRESUPUESTO ${marker}`,
      description: 'Reparación de prueba',
      categoryId: category.id,
      budgetMin: 500,
      budgetMax: 800,
      city: 'Chicago',
      state: 'IL',
      zipcode: '60601'
    });

    assert.equal(created.budgetMin, null);
    assert.equal(created.budgetMax, null);
    console.log('CORRECTO - Publicación ignora presupuesto');

    await assert.rejects(
      controller.updateJobRequest(req, created.id, {
        budgetMin: 500,
        budgetMax: 800
      }),
      /presupuesto inicial/
    );
    console.log('CORRECTO - Edición rechaza presupuesto');

    const edited = await controller.updateJobRequest(
      req,
      created.id,
      { description: 'Descripción modificada correctamente' }
    );

    assert.equal(
      edited.description,
      'Descripción modificada correctamente'
    );
    console.log('CORRECTO - Edición legítima aceptada');

    assert.equal(edited.budgetMin, null);
    assert.equal(edited.budgetMax, null);
    console.log('CORRECTO - Presupuestos permanecen nulos');

    console.log('PASO 414 COMPLETADO');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('ERROR:', error.message);
  process.exitCode = 1;
});
