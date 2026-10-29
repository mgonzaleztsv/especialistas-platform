
const test = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');

function checkDatabase() {
  const u = new URL(process.env.DATABASE_URL || '');
  assert.ok(['postgres:', 'postgresql:'].includes(u.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(u.hostname));
  assert.equal(u.port, '5433');
  assert.equal(u.pathname, '/connectpro_test');
}

test('790.1 - Duplicados rechazados e historial permitido', async () => {
  checkDatabase();
  const prisma = new PrismaClient();

  try {
    await prisma.$connect();

    await assert.rejects(
      prisma.$transaction(async tx => {
        const user = await tx.user.create({
          data: {
            name: 'Cliente prueba 790',
            email: 'cliente790@example.invalid',
            passwordHash: 'TEST_ONLY',
            role: 'CLIENT'
          }
        });

        const client = await tx.client.create({
          data: { userId: user.id }
        });

        const category = await tx.category.create({
          data: {
            name: 'Categoría prueba 790',
            slug: 'categoria-790'
          }
        });

        const job = await tx.jobRequest.create({
          data: {
            clientId: client.id,
            categoryId: category.id,
            title: 'Trabajo ficticio 790',
            description: 'Prueba de duplicados',
            city: 'Chicago',
            state: 'IL',
            status: 'AWAITING_CLIENT_CONFIRMATION',
            reviewPeriodHours: 48,
            workCompletedAt: new Date(),
            reviewDeadline: new Date(Date.now() + 86400000)
          }
        });

        const first = await tx.completionClaim.create({
          data: {
            jobRequestId: job.id,
            clientId: client.id,
            description: 'Primera reclamación',
            status: 'PENDING'
          }
        });

        console.log('CORRECTO - Primera reclamación registrada');

        // Un SAVEPOINT permite recuperar la transacción
        // después de un error esperado de PostgreSQL.
        await tx.$executeRawUnsafe('SAVEPOINT claim_duplicate_790');

        let rejected = false;

        try {
          await tx.completionClaim.create({
            data: {
              jobRequestId: job.id,
              clientId: client.id,
              description: 'Segunda reclamación abierta',
              status: 'DISPUTED'
            }
          });
        } catch (error) {
          rejected = true;
          await tx.$executeRawUnsafe(
            'ROLLBACK TO SAVEPOINT claim_duplicate_790'
          );
        }

        assert.equal(rejected, true);
        console.log('CORRECTO - Duplicado abierto rechazado');

        await tx.completionClaim.update({
          where: { id: first.id },
          data: {
            status: 'RESOLVED',
            resolvedAt: new Date()
          }
        });

        const second = await tx.completionClaim.create({
          data: {
            jobRequestId: job.id,
            clientId: client.id,
            description: 'Nueva reclamación posterior',
            status: 'PENDING'
          }
        });

        assert.ok(second.id);

        const claims = await tx.completionClaim.findMany({
          where: { jobRequestId: job.id }
        });

        assert.equal(claims.length, 2);
        assert.equal(
          claims.filter(c => c.status === 'PENDING').length,
          1
        );

        console.log('CORRECTO - Historial resuelto conservado');
        console.log('CORRECTO - Nueva reclamación abierta permitida');

        throw new Error('ROLLBACK_790');
      }, { timeout: 15000 }),
      error => error.message === 'ROLLBACK_790'
    );

    console.log('CORRECTO - Todos los datos ficticios revertidos');

  } finally {
    await prisma.$disconnect();
  }
});
