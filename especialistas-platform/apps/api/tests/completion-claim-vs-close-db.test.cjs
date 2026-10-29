
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient, Prisma } = require('@prisma/client');
const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

function controller(prisma) {
  const c = Object.create(JobRequestsController.prototype);
  c.prisma = prisma;
  c.retryTransaction = async fn => {
    for (let n = 0; n < 5; n++) {
      try {
        return await fn();
      } catch (e) {
        if (e.code !== 'P2034' || n === 4) throw e;
      }
    }
  };
  return c;
}

// Transición de prueba sin pagos: utiliza el mismo bloqueo
// y las mismas condiciones de estado y reclamación.
async function closeWithoutPayment(prisma, jobId, clientId) {
  for (let n = 0; n < 5; n++) {
    try {
      return await prisma.$transaction(async tx => {
        const locked = await tx.$queryRaw`
          SELECT "id" FROM "JobRequest"
          WHERE "id" = ${jobId}
          FOR UPDATE
        `;

        if (locked.length !== 1) {
          throw new Error('Trabajo no disponible');
        }

        const job = await tx.jobRequest.findFirst({
          where: {
            id: jobId,
            clientId,
            status: 'AWAITING_CLIENT_CONFIRMATION'
          }
        });

        if (!job) {
          throw new Error('Trabajo ya no pendiente');
        }

        const open = await tx.completionClaim.count({
          where: {
            jobRequestId: jobId,
            status: {
              in: ['PENDING', 'CORRECTION_REQUESTED', 'DISPUTED']
            }
          }
        });

        if (open) {
          throw new Error('Reclamación abierta');
        }

        const changed = await tx.jobRequest.updateMany({
          where: {
            id: jobId,
            clientId,
            status: 'AWAITING_CLIENT_CONFIRMATION'
          },
          data: { status: 'COMPLETED' }
        });

        if (changed.count !== 1) {
          throw new Error('Estado modificado');
        }

        return true;
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });
    } catch (e) {
      if (e.code !== 'P2034' || n === 4) throw e;
    }
  }
}

test('803.1 - Reclamación y cierre no pueden prosperar juntos', async () => {
  const u = new URL(process.env.DATABASE_URL || '');
  assert.ok(['postgres:', 'postgresql:'].includes(u.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(u.hostname));
  assert.equal(u.port, '5433');
  assert.equal(u.pathname, '/connectpro_test');
  assert.notEqual(process.env.INTERNAL_MVP_PAYMENTS_ENABLED, 'true');

  const db = new PrismaClient();
  const first = new PrismaClient();
  const second = new PrismaClient();
  const marker = randomUUID().slice(0, 12);

  let userId = null;
  let clientId = null;
  let categoryId = null;
  let jobId = null;

  try {
    await Promise.all([
      db.$connect(), first.$connect(), second.$connect()
    ]);

    const user = await db.user.create({
      data: {
        name: 'Cliente prueba 803',
        email: `test803-${marker}@example.invalid`,
        passwordHash: 'TEST_ONLY',
        role: 'CLIENT'
      }
    });
    userId = user.id;

    const client = await db.client.create({
      data: { userId }
    });
    clientId = client.id;

    const category = await db.category.create({
      data: {
        name: `Categoría 803 ${marker}`,
        slug: `categoria-803-${marker}`
      }
    });
    categoryId = category.id;

    const job = await db.jobRequest.create({
      data: {
        clientId,
        categoryId,
        title: 'Trabajo ficticio 803',
        description: 'Concurrencia de revisión y cierre',
        city: 'Chicago',
        state: 'IL',
        status: 'AWAITING_CLIENT_CONFIRMATION',
        reviewPeriodHours: 48,
        workCompletedAt: new Date(),
        reviewDeadline: new Date(Date.now() + 86400000)
      }
    });
    jobId = job.id;

    const results = await Promise.allSettled([
      controller(first).createCompletionClaim(
        { user: { userId } },
        jobId,
        { description: 'La reparación presenta defectos' }
      ),
      closeWithoutPayment(second, jobId, clientId)
    ]);

    const successes = results.filter(x => x.status === 'fulfilled');
    const failures = results.filter(x => x.status === 'rejected');

    assert.equal(successes.length, 1);
    assert.equal(failures.length, 1);

    const finalJob = await db.jobRequest.findUniqueOrThrow({
      where: { id: jobId }
    });

    const claims = await db.completionClaim.findMany({
      where: { jobRequestId: jobId }
    });

    if (finalJob.status === 'COMPLETED') {
      assert.equal(claims.length, 0);
      console.log('CORRECTO - Cierre prevaleció, sin reclamación');
    } else {
      assert.equal(finalJob.status, 'AWAITING_CLIENT_CONFIRMATION');
      assert.equal(claims.length, 1);
      assert.equal(claims[0].status, 'PENDING');
      console.log('CORRECTO - Reclamación prevaleció, cierre bloqueado');
    }

    console.log('CORRECTO - Operaciones incompatibles no coexistieron');

  } finally {
    try {
      if (jobId) {
        await db.completionClaim.deleteMany({
          where: { jobRequestId: jobId }
        });
        await db.jobRequest.deleteMany({
          where: { id: jobId }
        });
      }
      if (categoryId) {
        await db.category.deleteMany({
          where: { id: categoryId }
        });
      }
      if (clientId) {
        await db.client.deleteMany({
          where: { id: clientId }
        });
      }
      if (userId) {
        await db.user.deleteMany({
          where: { id: userId }
        });
      }
    } finally {
      await Promise.all([
        db.$disconnect(),
        first.$disconnect(),
        second.$disconnect()
      ]);
    }
  }
});
