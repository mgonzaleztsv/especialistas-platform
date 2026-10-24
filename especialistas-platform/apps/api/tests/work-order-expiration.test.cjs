const test = require('node:test');
const assert = require('node:assert/strict');
const { WorkOrderExpirationService } = require(
  '../dist/job-requests/work-order-expiration.service.js'
);

function scenario({ expired = true, latest = true } = {}) {
  const calls = [];
  const now = Date.now();

  const order = {
    id: 'order-1',
    jobRequestId: 'job-1',
    proposalId: 'proposal-1',
    status: 'PENDING_ACCEPTANCE',
    responseDeadline: new Date(
      now + (expired ? -60000 : 600000)
    )
  };

  const tx = {
    workOrder: {
      findUnique: async () => order,
      findFirst: async () => ({
        id: latest ? order.id : 'order-newer'
      }),
      updateMany: async args => {
        calls.push(['workOrder', args]);
        return { count: 1 };
      }
    },
    jobRequest: {
      findUnique: async () => ({
        status: 'PENDING_AGREEMENT'
      }),
      updateMany: async args => {
        calls.push(['jobRequest', args]);
        return { count: 1 };
      }
    },
    proposal: {
      findUnique: async () => ({
        status: 'SELECTED'
      }),
      updateMany: async args => {
        calls.push(['proposal', args]);
        return { count: 1 };
      }
    }
  };

  const prisma = {
    $transaction: async (callback, options) => {
      calls.push(['transaction', options]);
      return callback(tx);
    }
  };

  const service = new WorkOrderExpirationService(prisma);
  return { service, calls, order };
}

test('368.1 Cierra una orden vencida', async () => {
  const s = scenario();
  assert.equal(
    await s.service.closeExpiredWorkOrder('order-1'),
    true
  );
});

test('368.2 Cambia la orden a CANCELLED', async () => {
  const s = scenario();
  await s.service.closeExpiredWorkOrder('order-1');
  assert.equal(
    s.calls.find(x => x[0] === 'workOrder')[1].data.status,
    'CANCELLED'
  );
});

test('368.3 Registra fecha y motivo del cierre', async () => {
  const s = scenario();
  await s.service.closeExpiredWorkOrder('order-1');
  const data = s.calls.find(x => x[0] === 'workOrder')[1].data;
  assert.ok(data.closedAt instanceof Date);
  assert.equal(data.closureReason, 'RESPONSE_DEADLINE_EXPIRED');
});

test('368.4 Libera la propuesta', async () => {
  const s = scenario();
  await s.service.closeExpiredWorkOrder('order-1');
  assert.equal(
    s.calls.find(x => x[0] === 'proposal')[1].data.status,
    'PENDING'
  );
});

test('368.5 Reabre la solicitud', async () => {
  const s = scenario();
  await s.service.closeExpiredWorkOrder('order-1');
  assert.equal(
    s.calls.find(x => x[0] === 'jobRequest')[1].data.status,
    'RECEIVING_QUOTES'
  );
});

test('368.6 Utiliza aislamiento Serializable', async () => {
  const s = scenario();
  await s.service.closeExpiredWorkOrder('order-1');
  assert.equal(
    s.calls.find(x => x[0] === 'transaction')[1].isolationLevel,
    'Serializable'
  );
});

test('368.7 No cierra una orden vigente', async () => {
  const s = scenario({ expired: false });
  assert.equal(
    await s.service.closeExpiredWorkOrder('order-1'),
    false
  );
  assert.equal(
    s.calls.filter(x => x[0] === 'workOrder').length,
    0
  );
});

test('368.8 No cierra una versión anterior', async () => {
  const s = scenario({ latest: false });
  assert.equal(
    await s.service.closeExpiredWorkOrder('order-1'),
    false
  );
  assert.equal(
    s.calls.filter(x => x[0] === 'workOrder').length,
    0
  );
});

test('369.1 Respeta una prórroga todavía vigente', async () => {
  const s = scenario({ expired: true });

  s.order.extensionApprovedAt =
    new Date(Date.now() - 60000);

  s.order.responseDeadline =
    new Date(Date.now() + 24 * 60 * 60 * 1000);

  assert.equal(
    await s.service.closeExpiredWorkOrder('order-1'),
    false
  );

  assert.equal(
    s.calls.filter(x => x[0] === 'workOrder').length,
    0
  );
});

test('369.2 Cierra al vencer el plazo ampliado', async () => {
  const s = scenario({ expired: true });

  s.order.extensionApprovedAt =
    new Date(Date.now() - 25 * 60 * 60 * 1000);

  s.order.responseDeadline =
    new Date(Date.now() - 60 * 60 * 1000);

  assert.equal(
    await s.service.closeExpiredWorkOrder('order-1'),
    true
  );

  const update = s.calls.find(x => x[0] === 'workOrder');
  assert.equal(update[1].data.status, 'CANCELLED');
});

test('369.3 Busca vencimientos por fecha límite', async () => {
  let query;

  const prisma = {
    workOrder: {
      findMany: async args => {
        query = args;
        return [];
      }
    }
  };

  const service = new WorkOrderExpirationService(prisma);

  await service.findExpiredWorkOrders();

  assert.equal(
    query.where.status,
    'PENDING_ACCEPTANCE'
  );

  assert.ok(
    query.where.responseDeadline.lte instanceof Date
  );

  assert.equal(
    query.where.jobRequest.status,
    'PENDING_AGREEMENT'
  );

  assert.equal(
    query.where.proposal.status,
    'SELECTED'
  );
});

async function simulateScheduledExpiration(enabled, failId = null) {
  const previous = process.env.WORK_ORDER_EXPIRATION_ENABLED;
  const processed = [];
  const orders = [{ id: 'order-1' }, { id: 'order-2' }];

  const prisma = {
    workOrder: {
      findMany: async () => orders
    }
  };

  const service = new WorkOrderExpirationService(prisma);
  service.logger.log = () => {};
  service.logger.error = () => {};

  service.closeExpiredWorkOrder = async id => {
    processed.push(id);
    if (id === failId) throw new Error('Error simulado');
    return true;
  };

  try {
    if (enabled) {
      process.env.WORK_ORDER_EXPIRATION_ENABLED = 'true';
    } else {
      delete process.env.WORK_ORDER_EXPIRATION_ENABLED;
    }

    const result = await service.reportExpiredWorkOrders();
    return { processed, result };
  } finally {
    if (previous === undefined) {
      delete process.env.WORK_ORDER_EXPIRATION_ENABLED;
    } else {
      process.env.WORK_ORDER_EXPIRATION_ENABLED = previous;
    }
  }
}

test('371.1 No cierra órdenes si está desactivado', async () => {
  const result = await simulateScheduledExpiration(false);
  assert.deepEqual(result.processed, []);
  assert.equal(result.result.length, 2);
});

test('371.2 Procesa órdenes al habilitarlo en simulación', async () => {
  const result = await simulateScheduledExpiration(true);
  assert.deepEqual(result.processed, ['order-1', 'order-2']);
});

test('371.3 Continúa cuando falla una orden', async () => {
  const result = await simulateScheduledExpiration(
    true, 'order-1'
  );
  assert.deepEqual(result.processed, ['order-1', 'order-2']);
});
