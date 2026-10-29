
const test = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient, Prisma } = require('@prisma/client');
const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

const ROLLBACK = 'ROLLBACK_CONTRACTING_725';

function validateDestination() {
  const url = new URL(process.env.DATABASE_URL || '');
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.equal(url.port, '5433');
  assert.equal(url.pathname, '/connectpro_test');
}

async function counts(db) {
  return Promise.all([
    db.user.count(),
    db.client.count(),
    db.specialist.count(),
    db.category.count(),
    db.jobRequest.count(),
    db.proposal.count(),
    db.workOrder.count(),
    db.payment.count()
  ]);
}

function controllerFor(tx) {
  const controller = Object.create(
    JobRequestsController.prototype
  );

  // Adaptación exclusiva para pruebas:
  // las transacciones internas utilizan la transacción externa.
  controller.prisma = new Proxy(tx, {
    get(target, property) {
      if (property === '$transaction') {
        return async callback => callback(tx);
      }
      return Reflect.get(target, property);
    }
  });

  controller.retryTransaction = async callback => callback();
  return controller;
}

const req = user => ({ user: { userId: user.id } });

test('725.1 - Contratación completa con PostgreSQL', async () => {
  validateDestination();

  const prisma = new PrismaClient();

  try {
    await prisma.$connect();

    assert.ok(
      (await counts(prisma)).every(n => n === 0),
      'La base de pruebas debe estar vacía'
    );

    await assert.rejects(
      prisma.$transaction(async tx => {
        const clientUser = await tx.user.create({
          data: {
            name: 'Cliente prueba 725',
            email: 'cliente725@example.invalid',
            passwordHash: 'TEST_ONLY',
            role: 'CLIENT'
          }
        });

        const specialistUser = await tx.user.create({
          data: {
            name: 'Especialista prueba 725',
            email: 'especialista725@example.invalid',
            passwordHash: 'TEST_ONLY',
            role: 'SPECIALIST'
          }
        });

        const client = await tx.client.create({
          data: { userId: clientUser.id }
        });

        const specialist = await tx.specialist.create({
          data: { userId: specialistUser.id }
        });

        const category = await tx.category.create({
          data: {
            name: 'Categoría 725',
            slug: 'categoria-725'
          }
        });

        const job = await tx.jobRequest.create({
          data: {
            clientId: client.id,
            categoryId: category.id,
            title: 'Reparación de prueba',
            description: 'Prueba integral de contratación',
            city: 'Chicago',
            state: 'IL',
            status: 'PUBLISHED'
          }
        });

        const proposal = await tx.proposal.create({
          data: {
            jobRequestId: job.id,
            specialistId: specialist.id,
            amount: '150.00',
            materialsAmount: '0'
          }
        });

        const controller = controllerFor(tx);

        await controller.acceptProposal(
          req(clientUser),
          job.id,
          proposal.id
        );

        let currentJob = await tx.jobRequest.findUnique({
          where: { id: job.id }
        });

        let currentProposal = await tx.proposal.findUnique({
          where: { id: proposal.id }
        });

        let order = await tx.workOrder.findFirst({
          where: { jobRequestId: job.id }
        });

        assert.equal(currentJob.status, 'PENDING_AGREEMENT');
        assert.equal(currentProposal.status, 'SELECTED');
        assert.equal(order.status, 'PENDING_ACCEPTANCE');
        assert.equal(order.version, 1);
        assert.equal(order.respondingParty, 'CLIENT');
        assert.ok(order.responseDeadline > new Date());

        console.log('CORRECTO - Propuesta seleccionada y orden creada');

        const outsider = await tx.user.create({
          data: {
            name: 'Tercero prueba 726',
            email: 'tercero726@example.invalid',
            passwordHash: 'TEST_ONLY',
            role: 'CLIENT'
          }
        });

        await assert.rejects(
          () => controller.acceptWorkOrder(
            req(outsider),
            job.id
          ),
          error => /permiso|autoriz/i.test(error.message)
        );

        const unchanged = await tx.workOrder.findUnique({
          where: { id: order.id }
        });

        assert.equal(unchanged.status, 'PENDING_ACCEPTANCE');
        assert.equal(unchanged.clientAcceptedAt, null);
        assert.equal(unchanged.specialistAcceptedAt, null);
        assert.equal(
          await tx.payment.count({
            where: { jobRequestId: job.id }
          }),
          0
        );

        console.log('CORRECTO - Tercero rechazado sin modificaciones');

        await controller.acceptWorkOrder(
          req(clientUser),
          job.id
        );

        order = await tx.workOrder.findUnique({
          where: { id: order.id }
        });

        assert.ok(order.clientAcceptedAt);
        assert.equal(order.specialistAcceptedAt, null);
        assert.equal(order.status, 'PENDING_ACCEPTANCE');

        console.log('CORRECTO - Primera aceptación registrada');

        await controller.acceptWorkOrder(
          req(specialistUser),
          job.id
        );

        order = await tx.workOrder.findUnique({
          where: { id: order.id }
        });

        currentJob = await tx.jobRequest.findUnique({
          where: { id: job.id }
        });

        currentProposal = await tx.proposal.findUnique({
          where: { id: proposal.id }
        });

        const payment = await tx.payment.findUnique({
          where: { jobRequestId: job.id }
        });

        assert.equal(order.status, 'ACCEPTED');
        assert.ok(order.clientAcceptedAt);
        assert.ok(order.specialistAcceptedAt);
        assert.equal(currentProposal.status, 'ACCEPTED');
        assert.equal(currentJob.status, 'AWAITING_PAYMENT');

        assert.ok(payment);
        assert.equal(payment.status, 'PENDING');
        assert.equal(payment.proposalId, proposal.id);
        assert.equal(payment.clientId, client.id);
        assert.equal(payment.specialistId, specialist.id);
        assert.equal(Number(payment.amount), 150);

        console.log('CORRECTO - Ambas partes aceptaron');
        console.log('CORRECTO - Pago pendiente creado correctamente');

        await assert.rejects(
          () => controller.acceptWorkOrder(
            req(clientUser),
            job.id
          ),
          error => /no existe una Orden de Trabajo pendiente/i.test(
            error.message
          )
        );

        await assert.rejects(
          () => controller.acceptWorkOrder(
            req(specialistUser),
            job.id
          ),
          error => /no existe una Orden de Trabajo pendiente/i.test(
            error.message
          )
        );

        assert.equal(
          await tx.payment.count({
            where: { jobRequestId: job.id }
          }),
          1
        );

        assert.equal(
          await tx.workOrder.count({
            where: {
              jobRequestId: job.id,
              status: 'ACCEPTED'
            }
          }),
          1
        );

        console.log(
          'CORRECTO - Repeticiones rechazadas; un solo pago y una orden'
        );

        assert.notEqual(
          process.env.INTERNAL_MVP_PAYMENTS_ENABLED,
          'true'
        );

        await assert.rejects(
          () => controller.confirmPayment(
            req(clientUser),
            job.id
          ),
          error => /pagos simulados no están habilitados/i.test(
            error.message
          )
        );

        const protectedPayment = await tx.payment.findUnique({
          where: { jobRequestId: job.id }
        });

        const protectedJob = await tx.jobRequest.findUnique({
          where: { id: job.id }
        });

        assert.equal(protectedPayment.status, 'PENDING');
        assert.equal(protectedPayment.paidAt, null);
        assert.equal(protectedJob.status, 'AWAITING_PAYMENT');

        console.log(
          'CORRECTO - Pago simulado rechazado sin alterar estados'
        );

        throw new Error(ROLLBACK);
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 30000,
        maxWait: 10000
      }),
      error => error.message === ROLLBACK
    );

    assert.ok(
      (await counts(prisma)).every(n => n === 0),
      'Se conservaron registros después de revertir'
    );

    console.log('CORRECTO - Transacción revertida por completo');

  } finally {
    await prisma.$disconnect();
  }
});
