const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

function controller(db) {
  const c = Object.create(JobRequestsController.prototype);
  c.prisma = db;
  c.retryTransaction = async fn => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (error.code !== 'P2034' || attempt === 4) {
          throw error;
        }
      }
    }
  };
  return c;
}

test('827.1 - Solo una respuesta y tercero rechazado', async () => {
  const url = new URL(process.env.DATABASE_URL || '');
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.equal(url.port, '5433');
  assert.equal(url.pathname, '/connectpro_test');

  const db = new PrismaClient();
  const first = new PrismaClient();
  const second = new PrismaClient();
  const marker = randomUUID().slice(0, 12);

  let clientUserId, specialistUserId, outsiderUserId;
  let clientId, specialistId, outsiderId, categoryId, jobId;

  try {
    await Promise.all([
      db.$connect(), first.$connect(), second.$connect()
    ]);

    clientUserId = (await db.user.create({
      data: {
        name: 'Cliente 827',
        email: `cliente827-${marker}@example.invalid`,
        passwordHash: 'TEST_ONLY',
        role: 'CLIENT'
      }
    })).id;

    specialistUserId = (await db.user.create({
      data: {
        name: 'Especialista 827',
        email: `especialista827-${marker}@example.invalid`,
        passwordHash: 'TEST_ONLY',
        role: 'SPECIALIST'
      }
    })).id;

    outsiderUserId = (await db.user.create({
      data: {
        name: 'Tercero 827',
        email: `tercero827-${marker}@example.invalid`,
        passwordHash: 'TEST_ONLY',
        role: 'SPECIALIST'
      }
    })).id;

    clientId = (await db.client.create({
      data: { userId: clientUserId }
    })).id;

    specialistId = (await db.specialist.create({
      data: { userId: specialistUserId }
    })).id;

    outsiderId = (await db.specialist.create({
      data: { userId: outsiderUserId }
    })).id;

    categoryId = (await db.category.create({
      data: {
        name: `Categoría 827 ${marker}`,
        slug: `categoria-827-${marker}`
      }
    })).id;

    jobId = (await db.jobRequest.create({
      data: {
        clientId,
        categoryId,
        title: 'Trabajo ficticio 827',
        description: 'Respuestas simultáneas de prueba',
        city: 'Chicago',
        state: 'IL',
        status: 'AWAITING_CLIENT_CONFIRMATION',
        reviewPeriodHours: 48,
        workCompletedAt: new Date(),
        reviewDeadline: new Date(Date.now() + 86400000)
      }
    })).id;

    await db.proposal.create({
      data: {
        jobRequestId: jobId,
        specialistId,
        amount: '150.00',
        status: 'ACCEPTED'
      }
    });

    const claim = await db.completionClaim.create({
      data: {
        jobRequestId: jobId,
        clientId,
        description: 'Reclamación ficticia por defectos',
        status: 'PENDING'
      }
    });

    const specialistReq = {
      user: { userId: specialistUserId }
    };

    const outsiderReq = {
      user: { userId: outsiderUserId }
    };

    await assert.rejects(
      controller(db).respondCompletionClaim(
        outsiderReq,
        jobId,
        claim.id,
        {
          action: 'DISPUTE',
          notes: 'Intento no autorizado desde otra cuenta'
        }
      ),
      error => error.status === 409
    );

    const unchanged = await db.completionClaim.findUniqueOrThrow({
      where: { id: claim.id }
    });

    assert.equal(unchanged.status, 'PENDING');
    assert.equal(unchanged.specialistRespondedAt, null);
    console.log('CORRECTO - Tercero rechazado sin cambios');

    // Verificación de consulta con PostgreSQL real.
    const clientClaims = await controller(db).getCompletionClaims(
      { user: { userId: clientUserId } },
      jobId
    );

    assert.equal(clientClaims.length, 1);
    assert.equal(clientClaims[0].id, claim.id);
    assert.equal(clientClaims[0].status, 'PENDING');

    const specialistClaims = await controller(db).getCompletionClaims(
      specialistReq,
      jobId
    );

    assert.equal(specialistClaims.length, 1);
    assert.equal(specialistClaims[0].id, claim.id);

    await assert.rejects(
      controller(db).getCompletionClaims(outsiderReq, jobId),
      error => error.status === 403
    );

    console.log('CORRECTO - Cliente y especialista pueden consultar');
    console.log('CORRECTO - Tercero no puede consultar');

    const results = await Promise.allSettled([
      controller(first).respondCompletionClaim(
        specialistReq,
        jobId,
        claim.id,
        {
          action: 'ACCEPT_CORRECTION',
          notes: 'Acepto realizar las correcciones necesarias'
        }
      ),
      controller(second).respondCompletionClaim(
        specialistReq,
        jobId,
        claim.id,
        {
          action: 'DISPUTE',
          notes: 'No estoy conforme con los defectos alegados'
        }
      )
    ]);

    const successes = results.filter(
      r => r.status === 'fulfilled'
    );
    const failures = results.filter(
      r => r.status === 'rejected'
    );

    assert.equal(successes.length, 1);
    assert.equal(failures.length, 1);

    const stored = await db.completionClaim.findUniqueOrThrow({
      where: { id: claim.id }
    });

    assert.ok([
      'CORRECTION_REQUESTED',
      'DISPUTED'
    ].includes(stored.status));

    assert.equal(stored.status, successes[0].value.status);
    assert.ok(stored.specialistRespondedAt instanceof Date);
    assert.ok(stored.specialistResponseNotes);

    const job = await db.jobRequest.findUniqueOrThrow({
      where: { id: jobId }
    });

    assert.equal(job.status, 'AWAITING_CLIENT_CONFIRMATION');

    console.log('CORRECTO - Una sola respuesta prevaleció');
    console.log('CORRECTO - No coexistieron estados contradictorios');

  } finally {
    try {
      if (jobId) {
        await db.completionClaim.deleteMany({
          where: { jobRequestId: jobId }
        });
        await db.proposal.deleteMany({
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
      if (specialistId || outsiderId) {
        await db.specialist.deleteMany({
          where: {
            id: {
              in: [specialistId, outsiderId].filter(Boolean)
            }
          }
        });
      }
      if (clientUserId || specialistUserId || outsiderUserId) {
        await db.user.deleteMany({
          where: {
            id: {
              in: [
                clientUserId,
                specialistUserId,
                outsiderUserId
              ].filter(Boolean)
            }
          }
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
