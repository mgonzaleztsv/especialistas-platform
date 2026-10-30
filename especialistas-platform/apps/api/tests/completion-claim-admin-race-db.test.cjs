
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

require('reflect-metadata');

const { PrismaClient } = require('@prisma/client');

const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

function verificarBase() {
  const url = new URL(process.env.DATABASE_URL || '');

  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.equal(url.port, '5433');
  assert.equal(url.pathname, '/connectpro_test');
  assert.equal(decodeURIComponent(url.username), 'connectpro_test');
}

function crearControlador(prisma) {
  const controller = Object.create(JobRequestsController.prototype);
  controller.prisma = prisma;
  return controller;
}

test('869.1 - Solo una resolución administrativa concurrente prevalece', async () => {
  verificarBase();

  const db = new PrismaClient();
  const first = new PrismaClient();
  const second = new PrismaClient();

  const id = () => crypto.randomUUID();
  const suffix = id();

  let clientUserId = null;
  let specialistUserId = null;
  let clientId = null;
  let specialistId = null;
  let categoryId = null;
  let jobId = null;
  let claimId = null;

  try {
    const clientUser = await db.user.create({
      data: {
        id: id(),
        name: 'Cliente prueba 869',
        email: `client869-${suffix}@example.test`,
        passwordHash: 'test-only',
        role: 'CLIENT'
      }
    });
    clientUserId = clientUser.id;

    const specialistUser = await db.user.create({
      data: {
        id: id(),
        name: 'Especialista prueba 869',
        email: `specialist869-${suffix}@example.test`,
        passwordHash: 'test-only',
        role: 'SPECIALIST'
      }
    });
    specialistUserId = specialistUser.id;

    const client = await db.client.create({
      data: {
        id: id(),
        userId: clientUserId
      }
    });
    clientId = client.id;

    const specialist = await db.specialist.create({
      data: {
        id: id(),
        userId: specialistUserId
      }
    });
    specialistId = specialist.id;

    const category = await db.category.create({
      data: {
        id: id(),
        name: `Categoria prueba 869 ${suffix}`,
        slug: `categoria-prueba-869-${suffix}`
      }
    });
    categoryId = category.id;

    const job = await db.jobRequest.create({
      data: {
        id: id(),
        clientId,
        categoryId,
        title: 'Trabajo de prueba administrativa',
        description: 'Comprobación de concurrencia de reclamaciones',
        city: 'Chicago',
        state: 'IL',
        zipcode: '60601',
        status: 'AWAITING_CLIENT_CONFIRMATION'
      }
    });
    jobId = job.id;

    const claim = await db.completionClaim.create({
      data: {
        id: id(),
        jobRequestId: jobId,
        clientId,
        description: 'Reclamación temporal para concurrencia',
        status: 'DISPUTED',
        specialistResponseNotes: 'Respuesta de prueba del especialista',
        specialistRespondedAt: new Date()
      }
    });
    claimId = claim.id;

    const controllerA = crearControlador(first);
    const controllerB = crearControlador(second);

    const results = await Promise.allSettled([
      controllerA.resolveCompletionClaimByAdmin(
        jobId,
        claimId,
        {
          decision: 'RESOLVED',
          resolutionNotes: 'Resolución administrativa A de prueba'
        }
      ),
      controllerB.resolveCompletionClaimByAdmin(
        jobId,
        claimId,
        {
          decision: 'REJECTED',
          resolutionNotes: 'Resolución administrativa B de prueba'
        }
      )
    ]);

    const successes = results.filter(x => x.status === 'fulfilled');
    const failures = results.filter(x => x.status === 'rejected');

    assert.equal(successes.length, 1);
    assert.equal(failures.length, 1);

    const finalClaim = await db.completionClaim.findUniqueOrThrow({
      where: { id: claimId }
    });

    assert.equal(finalClaim.status, successes[0].value.status);
    assert.ok(['RESOLVED', 'REJECTED'].includes(finalClaim.status));
    assert.ok(finalClaim.resolvedAt instanceof Date);

    const finalJob = await db.jobRequest.findUniqueOrThrow({
      where: { id: jobId }
    });

    assert.equal(finalJob.status, 'AWAITING_CLIENT_CONFIRMATION');

    const paymentCount = await db.payment.count({
      where: { jobRequestId: jobId }
    });

    assert.equal(paymentCount, 0);

    console.log('CORRECTO - Una sola resolución prevaleció');
    console.log('CORRECTO - No existen decisiones contradictorias');
    console.log('CORRECTO - Estado del trabajo conservado');
    console.log('CORRECTO - No se crearon pagos');

  } finally {
    try {
      if (claimId) {
        await db.completionClaim.deleteMany({
          where: { id: claimId }
        });
      }
      if (jobId) {
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
      if (specialistId) {
        await db.specialist.deleteMany({
          where: { id: specialistId }
        });
      }
      if (clientUserId) {
        await db.user.deleteMany({
          where: { id: clientUserId }
        });
      }
      if (specialistUserId) {
        await db.user.deleteMany({
          where: { id: specialistUserId }
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
