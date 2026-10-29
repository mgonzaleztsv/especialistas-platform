
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BadRequestException,
  ForbiddenException,
  NotFoundException
} = require('@nestjs/common');

const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

const CLIENT = 'cliente-1';
const SPECIALIST = 'especialista-1';
const OUTSIDER = 'tercero-1';

function setup(options = {}) {
  const calls = {
    created: [],
    updated: [],
    read: [],
    payments: []
  };

  const job = options.missing ? null : {
    client: { userId: CLIENT },
    proposals: [{
      id: 'propuesta-1',
      specialist: {
        id: 'perfil-especialista-1',
        userId: SPECIALIST
      }
    }]
  };

  const prisma = {
    jobRequest: {
      findFirst: async () => job
    },
    message: {
      updateMany: async (args) => {
        calls.updated.push(args);
        return { count: 1 };
      },
      findMany: async (args) => {
        calls.read.push(args);
        return [{ id: 'mensaje-1', body: 'Hola' }];
      },
      create: async (args) => {
        calls.created.push(args);
        return { id: 'mensaje-nuevo', ...args.data };
      }
    },
    payment: {
      findUnique: async (args) => {
        calls.payments.push(args);
        return options.payment === undefined
          ? null
          : options.payment;
      }
    }
  };

  const controller = Object.create(
    JobRequestsController.prototype
  );

  controller.prisma = prisma;

  return { controller, calls };
}

function request(userId) {
  return { user: { userId } };
}

async function rejectsStatus(fn, exception, status) {
  await assert.rejects(fn, error => {
    assert.ok(error instanceof exception);
    assert.equal(error.getStatus(), status);
    return true;
  });
}

test('679.1 - Cliente puede leer mensajes', async () => {
  const { controller, calls } = setup();
  const result = await controller.getJobMessages(
    request(CLIENT), 'trabajo-1'
  );
  assert.equal(result.length, 1);
  assert.equal(calls.read.length, 1);
});

test('679.2 - Especialista puede leer mensajes', async () => {
  const { controller } = setup();
  const result = await controller.getJobMessages(
    request(SPECIALIST), 'trabajo-1'
  );
  assert.equal(result.length, 1);
});

test('679.3 - Tercero no puede leer mensajes', async () => {
  const { controller, calls } = setup();
  await rejectsStatus(
    () => controller.getJobMessages(
      request(OUTSIDER), 'trabajo-1'
    ),
    ForbiddenException, 403
  );
  assert.equal(calls.read.length, 0);
  assert.equal(calls.updated.length, 0);
});

test('679.4 - Trabajo inexistente produce 404', async () => {
  const { controller } = setup({ missing: true });
  await rejectsStatus(
    () => controller.getJobMessages(
      request(CLIENT), 'trabajo-1'
    ),
    NotFoundException, 404
  );
});

test('679.5 - Lectura marca mensajes recibidos', async () => {
  const { controller, calls } = setup();
  await controller.getJobMessages(
    request(CLIENT), 'trabajo-1'
  );
  assert.equal(calls.updated.length, 1);
  assert.equal(
    calls.updated[0].where.senderId.not,
    CLIENT
  );
  assert.equal(calls.updated[0].where.readAt, null);
  assert.ok(calls.updated[0].data.readAt instanceof Date);
});

test('679.6 - Cliente puede enviar mensaje', async () => {
  const { controller, calls } = setup();
  await controller.sendJobMessage(
    request(CLIENT), 'trabajo-1',
    { body: 'Hola especialista' }
  );
  assert.equal(calls.created.length, 1);
  assert.equal(calls.created[0].data.senderId, CLIENT);
});

test('679.7 - Especialista puede enviar mensaje', async () => {
  const { controller, calls } = setup();
  await controller.sendJobMessage(
    request(SPECIALIST), 'trabajo-1',
    { body: 'Hola cliente' }
  );
  assert.equal(calls.created.length, 1);
});

test('679.8 - Tercero no puede enviar mensajes', async () => {
  const { controller, calls } = setup();
  await rejectsStatus(
    () => controller.sendJobMessage(
      request(OUTSIDER), 'trabajo-1',
      { body: 'Mensaje no autorizado' }
    ),
    ForbiddenException, 403
  );
  assert.equal(calls.created.length, 0);
});

test('679.9 - Mensajes vacíos son rechazados', async () => {
  const { controller, calls } = setup();
  await rejectsStatus(
    () => controller.sendJobMessage(
      request(CLIENT), 'trabajo-1',
      { body: '   ' }
    ),
    BadRequestException, 400
  );
  assert.equal(calls.created.length, 0);
});

test('679.10 - Mensajes largos son rechazados', async () => {
  const { controller, calls } = setup();
  await rejectsStatus(
    () => controller.sendJobMessage(
      request(CLIENT), 'trabajo-1',
      { body: 'A'.repeat(2001) }
    ),
    BadRequestException, 400
  );
  assert.equal(calls.created.length, 0);
});

test('679.11 - Dirección bloqueada sin pago', async () => {
  const { controller, calls } = setup();
  await rejectsStatus(
    () => controller.sendJobMessage(
      request(CLIENT), 'trabajo-1',
      { body: 'La dirección es 123 Main Street' }
    ),
    BadRequestException, 400
  );
  assert.equal(calls.created.length, 0);
});

test('679.12 - Dirección permitida con pago válido', async () => {
  const { controller, calls } = setup({
    payment: {
      status: 'PAID',
      specialistId: 'perfil-especialista-1',
      proposalId: 'propuesta-1'
    }
  });

  await controller.sendJobMessage(
    request(CLIENT), 'trabajo-1',
    { body: 'La dirección es 123 Main Street' }
  );
  assert.equal(calls.created.length, 1);
});


test('680.1 - Mensaje de 2000 caracteres permitido', async () => {
  const { controller, calls } = setup();
  await controller.sendJobMessage(
    request(CLIENT), 'trabajo-1',
    { body: 'A'.repeat(2000) }
  );
  assert.equal(calls.created.length, 1);
});

test('680.2 - Sin propuesta aceptada: lectura rechazada', async () => {
  const { controller } = setup({ missing: true });
  await rejectsStatus(
    () => controller.getJobMessages(
      request(CLIENT), 'trabajo-1'
    ),
    NotFoundException, 404
  );
});

test('680.3 - Sin propuesta aceptada: envío rechazado', async () => {
  const { controller, calls } = setup({ missing: true });
  await rejectsStatus(
    () => controller.sendJobMessage(
      request(CLIENT), 'trabajo-1',
      { body: 'Hola' }
    ),
    NotFoundException, 404
  );
  assert.equal(calls.created.length, 0);
});

test('680.4 - Pago pendiente bloquea dirección', async () => {
  const { controller, calls } = setup({
    payment: {
      status: 'PENDING',
      specialistId: 'perfil-especialista-1',
      proposalId: 'propuesta-1'
    }
  });
  await rejectsStatus(
    () => controller.sendJobMessage(
      request(CLIENT), 'trabajo-1',
      { body: 'La dirección es 123 Main Street' }
    ),
    BadRequestException, 400
  );
  assert.equal(calls.created.length, 0);
});

test('680.5 - Pago de otro especialista bloqueado', async () => {
  const { controller, calls } = setup({
    payment: {
      status: 'PAID',
      specialistId: 'otro-especialista',
      proposalId: 'propuesta-1'
    }
  });
  await rejectsStatus(
    () => controller.sendJobMessage(
      request(CLIENT), 'trabajo-1',
      { body: 'La dirección es 123 Main Street' }
    ),
    BadRequestException, 400
  );
  assert.equal(calls.created.length, 0);
});

test('680.6 - Pago de otra propuesta bloqueado', async () => {
  const { controller, calls } = setup({
    payment: {
      status: 'PAID',
      specialistId: 'perfil-especialista-1',
      proposalId: 'otra-propuesta'
    }
  });
  await rejectsStatus(
    () => controller.sendJobMessage(
      request(CLIENT), 'trabajo-1',
      { body: 'La dirección es 123 Main Street' }
    ),
    BadRequestException, 400
  );
  assert.equal(calls.created.length, 0);
});

test('680.7 - Pago liberado permite dirección', async () => {
  const { controller, calls } = setup({
    payment: {
      status: 'RELEASED',
      specialistId: 'perfil-especialista-1',
      proposalId: 'propuesta-1'
    }
  });
  await controller.sendJobMessage(
    request(CLIENT), 'trabajo-1',
    { body: 'La dirección es 123 Main Street' }
  );
  assert.equal(calls.created.length, 1);
});
