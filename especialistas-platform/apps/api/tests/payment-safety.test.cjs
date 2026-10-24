const test = require('node:test');
const assert = require('node:assert/strict');

const moduleExports = require(
  '../dist/job-requests/job-requests.controller.js'
);
const Controller = Object.values(moduleExports).find(
  x => typeof x === 'function' &&
  x.prototype?.confirmPayment &&
  x.prototype?.confirmJobCompletion
);
assert.ok(Controller, 'Controlador compilado no localizado');

const request = { user: { userId: 'user-1' } };

function setup(kind, opts = {}) {
  const events = [];
  let state = {
    payment: kind === 'confirm' ? 'PENDING' : 'PAID',
    job: kind === 'confirm'
      ? 'AWAITING_PAYMENT'
      : 'AWAITING_CLIENT_CONFIRMATION'
  };

  const prisma = {
    client: {
      findUnique: async () => ({ id: 'client-1' })
    },
    payment: {
      findFirst: async () => ({
        id: 'payment-1',
        clientId: 'client-1'
      })
    },
    jobRequest: {
      findFirst: async () => ({
        id: 'job-1',
        clientId: 'client-1',
        payment: {
          id: 'payment-1',
          status: state.payment,
          provider: opts.provider || 'INTERNAL_MVP'
        }
      })
    },
    $transaction: async (callback, options) => {
      events.push(['transaction', options]);
      const pending = { ...state };
      const tx = {
        payment: {
          updateMany: async args => {
            events.push(['payment', args]);
            if (opts.paymentConflict ||
                pending.payment !== args.where.status) {
              return { count: 0 };
            }
            pending.payment = args.data.status;
            return { count: 1 };
          },
          findUniqueOrThrow: async () => ({
            id: 'payment-1',
            status: pending.payment
          })
        },
        jobRequest: {
          updateMany: async args => {
            events.push(['job', args]);
            if (opts.jobConflict ||
                pending.job !== args.where.status) {
              return { count: 0 };
            }
            pending.job = args.data.status;
            return { count: 1 };
          },
          findUniqueOrThrow: async () => ({
            id: 'job-1',
            status: pending.job
          })
        }
      };
      const result = await callback(tx);
      state = pending;
      return result;
    }
  };

  const context = {
    prisma,
    retryTransaction: fn => fn()
  };
  return {
    context,
    events,
    state: () => state
  };
}

async function invoke(kind, s) {
  if (kind === 'confirm') {
    return Controller.prototype.confirmPayment.call(
      s.context, request, 'job-1'
    );
  }
  return Controller.prototype.confirmJobCompletion.call(
    s.context, request, 'job-1'
  );
}

async function withFlag(enabled, fn) {
  const previous = process.env.INTERNAL_MVP_PAYMENTS_ENABLED;
  try {
    if (enabled) {
      process.env.INTERNAL_MVP_PAYMENTS_ENABLED = 'true';
    } else {
      delete process.env.INTERNAL_MVP_PAYMENTS_ENABLED;
    }
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.INTERNAL_MVP_PAYMENTS_ENABLED;
    } else {
      process.env.INTERNAL_MVP_PAYMENTS_ENABLED = previous;
    }
  }
}

test('378.1 Confirmación desactivada', async () => {
  const s = setup('confirm');
  await withFlag(false, async () => {
    await assert.rejects(invoke('confirm', s));
  });
  assert.equal(s.state().payment, 'PENDING');
});

test('378.2 Confirmación correcta', async () => {
  const s = setup('confirm');
  await withFlag(true, async () => {
    await invoke('confirm', s);
  });
  assert.equal(s.state().payment, 'PAID');
  assert.equal(s.state().job, 'ASSIGNED');
  assert.equal(s.events[0][1].isolationLevel, 'Serializable');
});

test('378.3 Rechaza pago cambiado', async () => {
  const s = setup('confirm', { paymentConflict: true });
  await withFlag(true, async () => {
    await assert.rejects(invoke('confirm', s));
  });
  assert.equal(s.state().payment, 'PENDING');
});

test('378.4 Revierte si la solicitud cambia', async () => {
  const s = setup('confirm', { jobConflict: true });
  await withFlag(true, async () => {
    await assert.rejects(invoke('confirm', s));
  });
  assert.equal(s.state().payment, 'PENDING');
});

test('378.5 Liberación desactivada', async () => {
  const s = setup('release');
  await withFlag(false, async () => {
    await assert.rejects(invoke('release', s));
  });
  assert.equal(s.state().payment, 'PAID');
});

test('378.6 Liberación correcta', async () => {
  const s = setup('release');
  await withFlag(true, async () => {
    await invoke('release', s);
  });
  assert.equal(s.state().payment, 'RELEASED');
  assert.equal(s.state().job, 'COMPLETED');
  assert.equal(s.events[0][1].isolationLevel, 'Serializable');
});

test('378.7 Rechaza proveedor externo', async () => {
  const s = setup('release', { provider: 'EXTERNAL' });
  await withFlag(true, async () => {
    await assert.rejects(invoke('release', s));
  });
  assert.equal(s.state().payment, 'PAID');
});
