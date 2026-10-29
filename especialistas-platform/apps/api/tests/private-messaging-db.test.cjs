
const test = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');

const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

const ROLLBACK = 'CONNECTPRO_DB_TEST_ROLLBACK';

function validateDatabaseUrl() {
  const value = process.env.DATABASE_URL || '';
  const parsed = new URL(value);

  assert.ok(
    ['postgresql:', 'postgres:'].includes(parsed.protocol),
    'Protocolo PostgreSQL requerido'
  );

  assert.ok(
    ['localhost', '127.0.0.1'].includes(parsed.hostname),
    'Solo se permite conexión local'
  );

  assert.equal(parsed.port, '5433');
  assert.equal(parsed.pathname, '/connectpro_test');

  return value;
}

test('715.1 - Configuración aislada validada', () => {
  const url = validateDatabaseUrl();
  assert.ok(url.length > 0);
});

function createController(tx) {
  const controller = Object.create(
    JobRequestsController.prototype
  );

  controller.prisma = tx;

  return controller;
}

function request(userId) {
  return { user: { userId } };
}

async function withRollback(callback) {
  validateDatabaseUrl();

  const prisma = new PrismaClient();

  try {
    await prisma.$connect();

    const initial = await Promise.all([
      prisma.user.count(),
      prisma.jobRequest.count(),
      prisma.message.count()
    ]);

    assert.ok(
      initial.every(n => n === 0),
      'La base de pruebas debe estar vacía'
    );

    const marker = ROLLBACK;

    await assert.rejects(
      prisma.$transaction(async tx => {
        await callback(tx);
        throw new Error(marker);
      }, {
        timeout: 30000,
        maxWait: 10000
      }),
      error => error.message === marker
    );

    const final = await Promise.all([
      prisma.user.count(),
      prisma.jobRequest.count(),
      prisma.message.count()
    ]);

    assert.ok(
      final.every(n => n === 0),
      'La transacción dejó registros persistentes'
    );

  } finally {
    await prisma.$disconnect();
  }
}

test('715.2 - Controlador transaccional preparado', async () => {
  validateDatabaseUrl();

  const prisma = new PrismaClient();

  try {
    await prisma.$connect();

    await prisma.$transaction(async tx => {
      const controller = createController(tx);

      assert.equal(controller.prisma, tx);
      assert.equal(
        typeof controller.getJobMessages,
        'function'
      );
      assert.equal(
        typeof controller.sendJobMessage,
        'function'
      );

      assert.equal(typeof tx.message.create, 'function');
      assert.equal(typeof tx.message.findMany, 'function');
      assert.equal(typeof tx.message.updateMany, 'function');
    }, { timeout: 10000 });

  } finally {
    await prisma.$disconnect();
  }
});


test('717.1 - Envío y lectura con PostgreSQL real', async () => {
  await withRollback(async tx => {

    const clientUser = await tx.user.create({
      data: {
        name: 'Cliente prueba 717',
        email: 'cliente717@example.invalid',
        passwordHash: 'TEST_ONLY',
        role: 'CLIENT'
      }
    });

    const specialistUser = await tx.user.create({
      data: {
        name: 'Especialista prueba 717',
        email: 'especialista717@example.invalid',
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
        name: 'Categoría prueba 717',
        slug: 'categoria-prueba-717'
      }
    });

    const job = await tx.jobRequest.create({
      data: {
        clientId: client.id,
        categoryId: category.id,
        title: 'Servicio ficticio',
        description: 'Integración de mensajería',
        city: 'Chicago',
        state: 'IL',
        status: 'ASSIGNED'
      }
    });

    await tx.proposal.create({
      data: {
        jobRequestId: job.id,
        specialistId: specialist.id,
        amount: '150.00',
        status: 'ACCEPTED'
      }
    });

    const controller = createController(tx);

    const sent = await controller.sendJobMessage(
      request(clientUser.id),
      job.id,
      { body: 'Hola desde PostgreSQL real' }
    );

    assert.equal(sent.body, 'Hola desde PostgreSQL real');
    assert.equal(sent.senderId, clientUser.id);

    const messages = await controller.getJobMessages(
      request(specialistUser.id),
      job.id
    );

    assert.equal(messages.length, 1);
    assert.equal(messages[0].id, sent.id);

    const stored = await tx.message.findUnique({
      where: { id: sent.id }
    });

    assert.ok(stored);
    assert.ok(stored.readAt instanceof Date);

    console.log(
      'CORRECTO - Mensaje enviado, leído y marcado como leído'
    );

  });
});


test('718.1 - Tercero bloqueado con PostgreSQL real', async () => {
  const { ForbiddenException } = require('@nestjs/common');

  await withRollback(async tx => {
    const users = [];

    for (const [name, role] of [
      ['Cliente', 'CLIENT'],
      ['Especialista', 'SPECIALIST'],
      ['Tercero', 'CLIENT']
    ]) {
      users.push(await tx.user.create({
        data: {
          name: name + ' prueba 718',
          email: name.toLowerCase() + '718@example.invalid',
          passwordHash: 'TEST_ONLY',
          role
        }
      }));
    }

    const [clientUser, specialistUser, outsider] = users;

    const client = await tx.client.create({
      data: { userId: clientUser.id }
    });

    const specialist = await tx.specialist.create({
      data: { userId: specialistUser.id }
    });

    const category = await tx.category.create({
      data: {
        name: 'Categoría 718',
        slug: 'categoria-718'
      }
    });

    const job = await tx.jobRequest.create({
      data: {
        clientId: client.id,
        categoryId: category.id,
        title: 'Trabajo ficticio 718',
        description: 'Prueba de autorización',
        city: 'Chicago',
        state: 'IL',
        status: 'ASSIGNED'
      }
    });

    await tx.proposal.create({
      data: {
        jobRequestId: job.id,
        specialistId: specialist.id,
        amount: '100.00',
        status: 'ACCEPTED'
      }
    });

    const original = await tx.message.create({
      data: {
        jobRequestId: job.id,
        senderId: clientUser.id,
        body: 'Mensaje privado de prueba'
      }
    });

    const controller = createController(tx);

    await assert.rejects(
      () => controller.getJobMessages(
        request(outsider.id), job.id
      ),
      error =>
        error instanceof ForbiddenException &&
        error.getStatus() === 403
    );

    await assert.rejects(
      () => controller.sendJobMessage(
        request(outsider.id),
        job.id,
        { body: 'Intento no autorizado' }
      ),
      error =>
        error instanceof ForbiddenException &&
        error.getStatus() === 403
    );

    const messages = await tx.message.findMany({
      where: { jobRequestId: job.id }
    });

    assert.equal(messages.length, 1);
    assert.equal(messages[0].id, original.id);
    assert.equal(messages[0].readAt, null);

    console.log(
      'CORRECTO - Tercero sin acceso ni modificaciones'
    );
  });
});


test('719.1 - Protección de direcciones con PostgreSQL', async () => {
  const { BadRequestException } = require('@nestjs/common');

  await withRollback(async tx => {
    const clientUser = await tx.user.create({
      data: {
        name: 'Cliente 719',
        email: 'cliente719@example.invalid',
        passwordHash: 'TEST_ONLY',
        role: 'CLIENT'
      }
    });

    const specialistUser = await tx.user.create({
      data: {
        name: 'Especialista 719',
        email: 'especialista719@example.invalid',
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
        name: 'Categoría 719',
        slug: 'categoria-719'
      }
    });

    const job = await tx.jobRequest.create({
      data: {
        clientId: client.id,
        categoryId: category.id,
        title: 'Trabajo ficticio 719',
        description: 'Prueba de privacidad',
        city: 'Chicago',
        state: 'IL',
        status: 'ASSIGNED'
      }
    });

    const proposal = await tx.proposal.create({
      data: {
        jobRequestId: job.id,
        specialistId: specialist.id,
        amount: '150.00',
        status: 'ACCEPTED'
      }
    });

    const controller = createController(tx);
    const address = '123 Main Street';

    async function blocked() {
      await assert.rejects(
        () => controller.sendJobMessage(
          request(clientUser.id),
          job.id,
          { body: 'La dirección es ' + address }
        ),
        error =>
          error instanceof BadRequestException &&
          error.getStatus() === 400
      );
    }

    await blocked();
    console.log('CORRECTO - Sin pago: dirección bloqueada');

    const payment = await tx.payment.create({
      data: {
        jobRequestId: job.id,
        proposalId: proposal.id,
        clientId: client.id,
        specialistId: specialist.id,
        amount: '150.00',
        status: 'PENDING'
      }
    });

    await blocked();
    console.log('CORRECTO - Pago pendiente: dirección bloqueada');

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'PAID',
        proposalId: proposal.id,
        specialistId: specialist.id
      }
    });

    const secondUser = await tx.user.create({
      data: {
        name: 'Otro especialista 720',
        email: 'especialista720@example.invalid',
        passwordHash: 'TEST_ONLY',
        role: 'SPECIALIST'
      }
    });

    const secondSpecialist = await tx.specialist.create({
      data: { userId: secondUser.id }
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: { specialistId: secondSpecialist.id }
    });

    await blocked();
    console.log('CORRECTO - Otro especialista bloqueado');

    await tx.payment.update({
      where: { id: payment.id },
      data: { specialistId: specialist.id }
    });

    const secondJob = await tx.jobRequest.create({
      data: {
        clientId: client.id,
        categoryId: category.id,
        title: 'Trabajo adicional 720',
        description: 'Propuesta ficticia independiente',
        city: 'Chicago',
        state: 'IL'
      }
    });

    const secondProposal = await tx.proposal.create({
      data: {
        jobRequestId: secondJob.id,
        specialistId: secondSpecialist.id,
        amount: '100.00'
      }
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: { proposalId: secondProposal.id }
    });

    await blocked();
    console.log('CORRECTO - Otra propuesta bloqueada');

    await tx.payment.update({
      where: { id: payment.id },
      data: { proposalId: proposal.id }
    });

    const sent = await controller.sendJobMessage(
      request(clientUser.id),
      job.id,
      { body: 'La dirección es ' + address }
    );

    assert.ok(sent.id);
    console.log('CORRECTO - Pago confirmado: dirección permitida');

    const count = await tx.message.count({
      where: { jobRequestId: job.id }
    });

    assert.equal(count, 1);

  });
});
