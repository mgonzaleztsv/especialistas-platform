
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

function fixture(withClaim) {
  const calls = {
    transactions: 0,
    paymentUpdates: 0,
    jobUpdates: 0
  };

  const prisma = {
    client: {
      findUnique: async () => ({ id: 'client-805' })
    },
    jobRequest: {
      findFirst: async () => ({
        id: 'job-805',
        clientId: 'client-805',
        status: 'AWAITING_CLIENT_CONFIRMATION',
        payment: {
          id: 'payment-805',
          clientId: 'client-805',
          status: 'PAID',
          provider: 'INTERNAL_MVP'
        }
      }),
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
      count: async () => withClaim ? 1 : 0
    },
    $transaction: async () => {
      calls.transactions++;
      throw new Error('No debe iniciarse transacción');
    }
  };

  const controller = Object.create(
    JobRequestsController.prototype
  );

  controller.prisma = prisma;
  controller.retryTransaction = async callback => callback();

  return { controller, calls };
}

for (const withClaim of [false, true]) {
  test(
    `805 - Pagos desactivados, reclamación ${withClaim ? 'abierta' : 'ausente'}`,
    async () => {
      const previous = process.env.INTERNAL_MVP_PAYMENTS_ENABLED;

      try {
        delete process.env.INTERNAL_MVP_PAYMENTS_ENABLED;

        const { controller, calls } = fixture(withClaim);

        await assert.rejects(
          controller.confirmJobCompletion(
            { user: { userId: 'user-805' } },
            'job-805'
          ),
          error => /liberación simulada.*no está habilitada/i.test(
            error.message
          )
        );

        assert.equal(calls.transactions, 0);
        assert.equal(calls.paymentUpdates, 0);
        assert.equal(calls.jobUpdates, 0);

        console.log('CORRECTO - Confirmación económica bloqueada');
      } finally {
        if (previous === undefined) {
          delete process.env.INTERNAL_MVP_PAYMENTS_ENABLED;
        } else {
          process.env.INTERNAL_MVP_PAYMENTS_ENABLED = previous;
        }
      }
    }
  );
}
