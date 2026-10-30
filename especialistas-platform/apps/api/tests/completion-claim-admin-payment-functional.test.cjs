const test = require('node:test');
const assert = require('node:assert/strict');

const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

function preparar(estadoReclamacion) {
  const llamadas = {
    consultas: [],
    pagos: 0,
    trabajos: 0
  };

  const pago = {
    id: 'payment-886',
    clientId: 'client-886',
    status: 'PAID',
    provider: 'INTERNAL_MVP'
  };

  const trabajo = {
    id: 'job-886',
    clientId: 'client-886',
    status: 'AWAITING_CLIENT_CONFIRMATION',
    payment: pago
  };

  const prisma = {
    client: {
      findUnique: async () => ({ id: 'client-886' })
    },

    jobRequest: {
      findFirst: async () => ({ ...trabajo }),
      updateMany: async () => {
        llamadas.trabajos++;
        trabajo.status = 'COMPLETED';
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({
        id: trabajo.id,
        status: trabajo.status
      })
    },

    completionClaim: {
      count: async ({ where }) => {
        const estados = where.status.in;

        llamadas.consultas.push([...estados]);

        return estadoReclamacion &&
          estados.includes(estadoReclamacion) ? 1 : 0;
      }
    },

    payment: {
      updateMany: async () => {
        llamadas.pagos++;
        pago.status = 'RELEASED';
        return { count: 1 };
      }
    },

    $queryRaw: async () => [{ id: trabajo.id }]
  };

  prisma.$transaction = async (fn, options) => {
    assert.equal(options.isolationLevel, 'Serializable');
    return fn(prisma);
  };

  const controller = Object.create(
    JobRequestsController.prototype
  );

  controller.prisma = prisma;
  controller.retryTransaction = async fn => fn();

  return {
    controller,
    llamadas,
    pago,
    trabajo
  };
}

async function ejecutarConSimulacion(fixture) {
  const anterior = process.env.INTERNAL_MVP_PAYMENTS_ENABLED;

  try {
    // Habilitación temporal exclusivamente en este proceso de prueba.
    process.env.INTERNAL_MVP_PAYMENTS_ENABLED = 'true';

    return await fixture.controller.confirmJobCompletion(
      { user: { userId: 'user-886' } },
      'job-886'
    );
  } finally {
    if (anterior === undefined) {
      delete process.env.INTERNAL_MVP_PAYMENTS_ENABLED;
    } else {
      process.env.INTERNAL_MVP_PAYMENTS_ENABLED = anterior;
    }
  }
}

for (const estado of ['RESOLVED', 'REJECTED']) {
  test(`886 - ${estado} bloquea la liberación real del método`, async () => {
    const fixture = preparar(estado);

    await assert.rejects(
      ejecutarConSimulacion(fixture),
      error =>
        error.status === 409 &&
        /autorización financiera independiente/i.test(error.message)
    );

    assert.equal(fixture.llamadas.pagos, 0);
    assert.equal(fixture.llamadas.trabajos, 0);
    assert.equal(fixture.pago.status, 'PAID');
    assert.equal(
      fixture.trabajo.status,
      'AWAITING_CLIENT_CONFIRMATION'
    );

    assert.ok(
      fixture.llamadas.consultas.some(
        estados => estados.includes(estado)
      )
    );
  });
}

test('886 - PENDING sigue bloqueando confirmación', async () => {
  const fixture = preparar('PENDING');

  await assert.rejects(
    ejecutarConSimulacion(fixture),
    error =>
      error.status === 409 &&
      /reclamación de revisión pendiente/i.test(error.message)
  );

  assert.equal(fixture.llamadas.pagos, 0);
  assert.equal(fixture.llamadas.trabajos, 0);
  assert.equal(fixture.pago.status, 'PAID');
});

test('886 - Sin reclamaciones se conserva la confirmación', async () => {
  const fixture = preparar(null);

  const resultado = await ejecutarConSimulacion(fixture);

  assert.equal(resultado.status, 'COMPLETED');
  assert.equal(fixture.llamadas.pagos, 1);
  assert.equal(fixture.llamadas.trabajos, 1);
  assert.equal(fixture.pago.status, 'RELEASED');

  assert.ok(
    fixture.llamadas.consultas.some(
      estados => estados.includes('RESOLVED') &&
                 estados.includes('REJECTED')
    )
  );
});
