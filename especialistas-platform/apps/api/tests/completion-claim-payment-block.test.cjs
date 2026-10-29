
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

function fixture(
  claimStatus,
  currentPaymentStatus = 'PAID',
  initialPaymentStatus = currentPaymentStatus
) {
  const calls = {
    paymentUpdates: 0,
    jobUpdates: 0
  };

  const prisma = {
    client: {
      findUnique: async () => ({ id: 'client-794' })
    },
    jobRequest: {
      findFirst: async () => {
        calls.jobReads = (calls.jobReads || 0) + 1;
        return {
          id: 'job-794',
          clientId: 'client-794',
          status: 'AWAITING_CLIENT_CONFIRMATION',
          payment: {
            id: 'payment-794',
            clientId: 'client-794',
            status: calls.jobReads === 1
              ? initialPaymentStatus
              : currentPaymentStatus,
            provider: 'INTERNAL_MVP'
          }
        };
      },
      updateMany: async () => {
        calls.jobUpdates++;
        return { count: 1 };
      }
    },
    payment: {
      updateMany: async () => {
        calls.paymentUpdates++;
        return { count: 1 };
      }
    },
    completionClaim: {
      count: async ({ where }) => {
        return where.status.in.includes(claimStatus) ? 1 : 0;
      }
    }
  };

  prisma.$queryRaw = async (strings, ...values) => {
    const sql = strings.join('?');

    assert.match(sql, /FROM "JobRequest"/);
    assert.match(sql, /FOR UPDATE/);
    assert.equal(values.length, 1);
    assert.equal(values[0], 'job-794');

    return [{ id: 'job-794' }];
  };

  prisma.$transaction = async fn => fn(prisma);

  const controller = Object.create(
    JobRequestsController.prototype
  );

  controller.prisma = prisma;
  controller.retryTransaction = async fn => fn();

  return { controller, calls };
}

for (const status of [
  'PENDING',
  'CORRECTION_REQUESTED',
  'DISPUTED'
]) {
  test(`794 - ${status} bloquea confirmación y pago`, async () => {
    const previous = process.env.INTERNAL_MVP_PAYMENTS_ENABLED;

    try {
      process.env.INTERNAL_MVP_PAYMENTS_ENABLED = 'true';

      const { controller, calls } = fixture(status);

      await assert.rejects(
        controller.confirmJobCompletion(
          { user: { userId: 'user-794' } },
          'job-794'
        ),
        error => error.status === 409
      );

      assert.equal(calls.paymentUpdates, 0);
      assert.equal(calls.jobUpdates, 0);

      console.log(
        'CORRECTO - Sin cambios económicos con estado', status
      );
    } finally {
      if (previous === undefined) {
        delete process.env.INTERNAL_MVP_PAYMENTS_ENABLED;
      } else {
        process.env.INTERNAL_MVP_PAYMENTS_ENABLED = previous;
      }
    }
  });
}

test('799.1 - Pago cambiado bloquea confirmación', async () => {
  const previous = process.env.INTERNAL_MVP_PAYMENTS_ENABLED;

  try {
    process.env.INTERNAL_MVP_PAYMENTS_ENABLED = 'true';

    const { controller, calls } = fixture(
      'RESOLVED',
      'CANCELLED'
    );

    await assert.rejects(
      controller.confirmJobCompletion(
        { user: { userId: 'user-794' } },
        'job-794'
      )
    );

    assert.equal(calls.paymentUpdates, 0);
    assert.equal(calls.jobUpdates, 0);

    console.log('CORRECTO - Pago cambiado, sin modificaciones');
  } finally {
    if (previous === undefined) {
      delete process.env.INTERNAL_MVP_PAYMENTS_ENABLED;
    } else {
      process.env.INTERNAL_MVP_PAYMENTS_ENABLED = previous;
    }
  }
});

test('800.1 - Pago cambia entre consultas y bloquea confirmación', async () => {
  const previous = process.env.INTERNAL_MVP_PAYMENTS_ENABLED;

  try {
    process.env.INTERNAL_MVP_PAYMENTS_ENABLED = 'true';

    const { controller, calls } = fixture(
      'RESOLVED',
      'CANCELLED',
      'PAID'
    );

    await assert.rejects(
      controller.confirmJobCompletion(
        { user: { userId: 'user-794' } },
        'job-794'
      ),
      error => error.status === 409
    );

    assert.equal(calls.jobReads, 2);
    assert.equal(calls.paymentUpdates, 0);
    assert.equal(calls.jobUpdates, 0);

    console.log('CORRECTO - Cambio detectado dentro de transacción');
    console.log('CORRECTO - Ninguna actualización económica');
  } finally {
    if (previous === undefined) {
      delete process.env.INTERNAL_MVP_PAYMENTS_ENABLED;
    } else {
      process.env.INTERNAL_MVP_PAYMENTS_ENABLED = previous;
    }
  }
});
