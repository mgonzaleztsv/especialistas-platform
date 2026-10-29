
const test = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

function validateDestination() {
  const url = new URL(process.env.DATABASE_URL || '');
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.equal(url.port, '5433');
  assert.equal(url.pathname, '/connectpro_test');
}

test('732.1 - Selecciones simultáneas sin duplicaciones', async () => {
  validateDestination();

  const prisma = new PrismaClient();
  const first = new PrismaClient();
  const second = new PrismaClient();

  let clientUser;
  let specialistUsers = [];
  let category;
  let job;

  try {
    await Promise.all([
      prisma.$connect(),
      first.$connect(),
      second.$connect()
    ]);

    const suffix = Date.now().toString();

    clientUser = await prisma.user.create({
      data: {
        name: 'Cliente concurrencia732',
        email: 'cliente732-' + suffix + '@example.invalid',
        passwordHash: 'TEST_ONLY',
        role: 'CLIENT'
      }
    });

    const client = await prisma.client.create({
      data: { userId: clientUser.id }
    });

    for (let i = 1; i <= 2; i++) {
      const user = await prisma.user.create({
        data: {
          name: 'Especialista concurrencia732-' + i,
          email: 'especialista732-' + i + '-' + suffix + '@example.invalid',
          passwordHash: 'TEST_ONLY',
          role: 'SPECIALIST'
        }
      });

      specialistUsers.push(user);
    }

    const specialists = [];

    for (const user of specialistUsers) {
      specialists.push(await prisma.specialist.create({
        data: { userId: user.id }
      }));
    }

    category = await prisma.category.create({
      data: {
        name: 'Categoría concurrencia732',
        slug: 'concurrencia732-' + suffix
      }
    });

    job = await prisma.jobRequest.create({
      data: {
        clientId: client.id,
        categoryId: category.id,
        title: 'Trabajo concurrencia732',
        description: 'Selecciones simultáneas',
        city: 'Chicago',
        state: 'IL',
        status: 'PUBLISHED'
      }
    });

    const proposals = [];

    for (const specialist of specialists) {
      proposals.push(await prisma.proposal.create({
        data: {
          jobRequestId: job.id,
          specialistId: specialist.id,
          amount: '125.00'
        }
      }));
    }

    function controller(db) {
      const instance = Object.create(
        JobRequestsController.prototype
      );
      instance.prisma = db;
      return instance;
    }

    const userRequest = {
      user: { userId: clientUser.id }
    };

    const results = await Promise.allSettled([
      controller(first).acceptProposal(
        userRequest,
        job.id,
        proposals[0].id
      ),
      controller(second).acceptProposal(
        userRequest,
        job.id,
        proposals[1].id
      )
    ]);

    const successes = results.filter(
      result => result.status === 'fulfilled'
    );

    const failures = results.filter(
      result => result.status === 'rejected'
    );

    assert.equal(successes.length, 1);
    assert.equal(failures.length, 1);

    const storedProposals = await prisma.proposal.findMany({
      where: { jobRequestId: job.id }
    });

    const selected = storedProposals.filter(
      proposal => proposal.status === 'SELECTED'
    );

    const orders = await prisma.workOrder.findMany({
      where: { jobRequestId: job.id }
    });

    const currentJob = await prisma.jobRequest.findUnique({
      where: { id: job.id }
    });

    assert.equal(selected.length, 1);
    assert.equal(orders.length, 1);
    assert.equal(orders[0].status, 'PENDING_ACCEPTANCE');
    assert.equal(orders[0].proposalId, selected[0].id);
    assert.equal(currentJob.status, 'PENDING_AGREEMENT');

    console.log(
      'CORRECTO - Dos solicitudes; una selección y una orden'
    );

    const selectedProposal = await prisma.proposal.findUnique({
      where: { id: selected[0].id },
      include: { specialist: true }
    });

    const specialistUserId = selectedProposal.specialist.userId;

    const acceptResults = await Promise.allSettled([
      controller(first).acceptWorkOrder(
        { user: { userId: clientUser.id } },
        job.id
      ),
      controller(second).acceptWorkOrder(
        { user: { userId: specialistUserId } },
        job.id
      )
    ]);

    const rejected = acceptResults.filter(
      result => result.status === 'rejected'
    );

    console.log(
      'Aceptaciones simultáneas rechazadas:',
      rejected.length
    );

    for (const result of rejected) {
      console.log(
        'Motivo:',
        result.reason?.message || String(result.reason)
      );
    }

    let order = await prisma.workOrder.findUnique({
      where: { id: orders[0].id }
    });

    if (order.status === 'PENDING_ACCEPTANCE') {
      if (!order.clientAcceptedAt) {
        await controller(first).acceptWorkOrder(
          { user: { userId: clientUser.id } },
          job.id
        );
      }

      order = await prisma.workOrder.findUnique({
        where: { id: orders[0].id }
      });

      if (
        order.status === 'PENDING_ACCEPTANCE' &&
        !order.specialistAcceptedAt
      ) {
        await controller(second).acceptWorkOrder(
          { user: { userId: specialistUserId } },
          job.id
        );
      }
    }

    order = await prisma.workOrder.findUnique({
      where: { id: orders[0].id }
    });

    const payment = await prisma.payment.findUnique({
      where: { jobRequestId: job.id }
    });

    const jobAfter = await prisma.jobRequest.findUnique({
      where: { id: job.id }
    });

    assert.equal(order.status, 'ACCEPTED');
    assert.ok(order.clientAcceptedAt);
    assert.ok(order.specialistAcceptedAt);
    assert.ok(payment);
    assert.equal(payment.status, 'PENDING');
    assert.equal(jobAfter.status, 'AWAITING_PAYMENT');

    assert.equal(
      await prisma.payment.count({
        where: { jobRequestId: job.id }
      }),
      1
    );

    console.log(
      'CORRECTO - Aceptaciones completadas sin pago duplicado'
    );

  } finally {
    // Limpieza restringida a los identificadores creados
    // por esta prueba, exclusivamente en connectpro_test.
    try {
      if (job) {
        await prisma.payment.deleteMany({
          where: { jobRequestId: job.id }
        });
        await prisma.workOrder.deleteMany({
          where: { jobRequestId: job.id }
        });
        await prisma.proposal.deleteMany({
          where: { jobRequestId: job.id }
        });
        await prisma.jobRequest.deleteMany({
          where: { id: job.id }
        });
      }

      if (category) {
        await prisma.category.deleteMany({
          where: { id: category.id }
        });
      }

      for (const user of specialistUsers) {
        await prisma.specialist.deleteMany({
          where: { userId: user.id }
        });
        await prisma.user.deleteMany({
          where: { id: user.id }
        });
      }

      if (clientUser) {
        await prisma.client.deleteMany({
          where: { userId: clientUser.id }
        });
        await prisma.user.deleteMany({
          where: { id: clientUser.id }
        });
      }

    } finally {
      await Promise.all([
        prisma.$disconnect(),
        first.$disconnect(),
        second.$disconnect()
      ]);
    }
  }
});
