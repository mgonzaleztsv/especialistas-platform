
const test = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');

function verifyDestination() {
  const url = new URL(process.env.DATABASE_URL || '');
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.equal(url.port, '5433');
  assert.equal(url.pathname, '/connectpro_test');
}

test('789.1 - Una sola reclamación abierta por trabajo', async () => {
  verifyDestination();

  const prisma = new PrismaClient();

  try {
    await prisma.$connect();

    await assert.rejects(
      prisma.$transaction(async tx => {
        const user = await tx.user.create({
          data: {
            name: 'Cliente prueba 789',
            email: 'cliente789@example.invalid',
            passwordHash: 'TEST_ONLY',
            role: 'CLIENT'
          }
        });

        const client = await tx.client.create({
          data: { userId: user.id }
        });

        const category = await tx.category.create({
          data: {
            name: 'Categoría prueba 789',
            slug: 'categoria-789'
          }
        });

        const job = await tx.jobRequest.create({
          data: {
            clientId: client.id,
            categoryId: category.id,
            title: 'Trabajo ficticio 789',
            description: 'Prueba de reclamaciones duplicadas',
            city: 'Chicago',
            state: 'IL',
            status: 'AWAITING_CLIENT_CONFIRMATION',
            reviewPeriodHours: 48,
            workCompletedAt: new Date(),
            reviewDeadline: new Date(Date.now() + 86400000)
          }
        });

        await tx.completionClaim.create({
          data: {
            jobRequestId: job.id,
            clientId: client.id,
            description: 'Primera reclamación de prueba',
            status: 'PENDING'
          }
        });

        // Verificar la restricción directamente en PostgreSQL.
        const indexes = await tx.$queryRaw`
          SELECT indexdef
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'CompletionClaim'
            AND indexname = 'CompletionClaim_one_open_per_job_idx'
        `;

        assert.equal(indexes.length, 1);
        assert.match(indexes[0].indexdef, /UNIQUE INDEX/);
        assert.match(indexes[0].indexdef, /jobRequestId/);

        // La transacción se revierte intencionadamente.
        throw new Error('ROLLBACK_789');
      }),
      error => error.message === 'ROLLBACK_789'
    );

    console.log('CORRECTO - Índice único existente y verificado');
    console.log('CORRECTO - Registros ficticios revertidos');

  } finally {
    await prisma.$disconnect();
  }
});
