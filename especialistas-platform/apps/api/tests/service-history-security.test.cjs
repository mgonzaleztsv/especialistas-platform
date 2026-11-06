const test = require('node:test');
const assert = require('node:assert/strict');

const {
  JobRequestsController,
} = require('../dist/job-requests/job-requests.controller.js');

function setup(clientId, specialistId, jobs = []) {
  const calls = [];

  const prisma = {
    client: {
      findUnique: async () =>
        clientId ? { id: clientId } : null,
    },
    specialist: {
      findUnique: async () =>
        specialistId ? { id: specialistId } : null,
    },
    jobRequest: {
      findMany: async args => {
        calls.push(args);
        return jobs;
      },
    },
  };

  return {
    controller: new JobRequestsController(prisma),
    calls,
  };
}

function job(options = {}) {
  const specialistId = options.specialistId || 's1';

  return {
    id: options.id || 'job1',
    title: 'Servicio de prueba',
    status: options.status || 'COMPLETED',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-03'),
    workCompletedAt: new Date('2026-01-02'),
    clientId: options.clientId || 'c1',
    client: {
      user: {
        name: 'Cliente de prueba',
      },
    },
    payment: options.noPayment ? null : {
      amount: '150.00',
      currency: 'USD',
      status: options.paymentStatus || 'RELEASED',
      paidAt: options.unpaid ? null : new Date('2026-01-02'),
      releasedAt: options.unpaid ? null : new Date('2026-01-03'),
      refundedAt: null,
      specialistId,
      specialist: {
        user: {
          name: 'Especialista de prueba',
        },
      },
    },
    workOrders: [{
      laborAmount: '120.00',
      materialsAmount: '30.00',
      currency: 'USD',
      proposal: {
        specialistId,
        specialist: {
          user: {
            name: 'Especialista de prueba',
          },
        },
      },
    }],
  };
}

const req = { user: { userId: 'test-user' } };

test('1012.1: usuario sin perfiles', async () => {
  const s = setup(null, null);
  assert.deepEqual(await s.controller.serviceHistory(req), []);
  assert.equal(s.calls.length, 0);
});

test('1012.2: cliente consulta sus servicios', async () => {
  const s = setup('c1', null, [job()]);
  const result = await s.controller.serviceHistory(req);

  assert.equal(result.length, 1);
  assert.equal(result[0].role, 'CLIENT');
  assert.equal(result[0].counterpartName, 'Especialista de prueba');
  assert.deepEqual(s.calls[0].where.OR, [{ clientId: 'c1' }]);
  assert.deepEqual(
    s.calls[0].where.status.in,
    ['COMPLETED', 'CANCELLED']
  );
});

test('1012.3: especialista consulta sus servicios', async () => {
  const s = setup(null, 's1', [job()]);
  const result = await s.controller.serviceHistory(req);

  assert.equal(result.length, 1);
  assert.equal(result[0].role, 'SPECIALIST');
  assert.equal(result[0].counterpartName, 'Cliente de prueba');

  const filter = JSON.stringify(s.calls[0].where);
  assert.ok(filter.includes('"specialistId":"s1"'));
  assert.ok(!filter.includes('"clientId":"c1"'));
});

test('1012.4: usuario con ambos perfiles', async () => {
  const s = setup('c1', 's1', [job()]);
  const result = await s.controller.serviceHistory(req);

  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map(x => x.role).sort(),
    ['CLIENT', 'SPECIALIST']
  );
});

test('1012.5: diferencia pago pendiente', async () => {
  const s = setup('c1', null, [
    job({ unpaid: true, paymentStatus: 'PENDING' }),
  ]);
  const result = await s.controller.serviceHistory(req);

  assert.equal(result[0].agreedAmount, 150);
  assert.equal(result[0].paymentAmount, null);
  assert.equal(result[0].paymentStatus, 'PENDING');
});

test('1012.6: no expone datos privados', async () => {
  const s = setup('c1', null, [job()]);
  const result = await s.controller.serviceHistory(req);
  const text = JSON.stringify(result);

  for (const field of [
    'serviceAddress',
    'latitude',
    'longitude',
    'email',
    'phone',
    'passwordHash',
  ]) {
    assert.ok(
      !text.includes('"' + field + '"'),
      'Dato privado expuesto: ' + field
    );
  }
});
