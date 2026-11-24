require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Test } = require('@nestjs/testing');
const { MODULE_METADATA } = require('@nestjs/common/constants');

const { PaymentsModule } = require('../dist/payments/payments.module.js');
const { PrismaService } = require('../dist/prisma/prisma.service.js');
const { StripeTestClientService } = require('../dist/payments/stripe-test-client.service.js');

const {
  StripeAccountCandidateSearchService: Search,
} = require('../dist/payments/stripe-account-candidate-search.service.js');

const {
  StripeAccountCreationEvidenceService: Account,
} = require('../dist/payments/stripe-account-creation-evidence.service.js');

const {
  StripeAccountEventEvidenceService: Event,
} = require('../dist/payments/stripe-account-event-evidence.service.js');

const {
  StripeAccountReconciliationService: Reconciliation,
} = require('../dist/payments/stripe-account-reconciliation.service.js');

test('Stripe: integracion segura del modulo', async (t) => {
  const previousMode = process.env.STRIPE_MODE;

  process.env.STRIPE_MODE = 'disabled';

  let context;
  let externalCalls = 0;
  let databaseCalls = 0;

  const forbidden = () => {
    throw new Error('Operacion no autorizada en esta prueba');
  };

  const prisma = {
    stripeAccountCreationRequest: {
      findUnique() {
        databaseCalls++;
        return forbidden();
      },
    },
    stripeConnectedAccount: {
      findUnique() {
        databaseCalls++;
        return forbidden();
      },
      findFirst() {
        databaseCalls++;
        return forbidden();
      },
    },
  };

  const stripe = {
    isEnabled() {
      return false;
    },
    getClient() {
      externalCalls++;
      return forbidden();
    },
  };

  try {
    context = await Test.createTestingModule({
      imports: [PaymentsModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(StripeTestClientService)
      .useValue(stripe)
      .compile();

    await t.test('1 - Contexto NestJS compilado', () => {
      assert.ok(context);
    });

    const payments = context.select(PaymentsModule);

    await t.test('2 - Servicio de busqueda disponible', () => {
      assert.ok(
        payments.get(Search, { strict: true })
          instanceof Search
      );
    });

    await t.test('3 - Evidencia actual disponible', () => {
      assert.ok(
        payments.get(Account, { strict: true })
          instanceof Account
      );
    });

    await t.test('4 - Evidencia historica disponible', () => {
      assert.ok(
        payments.get(Event, { strict: true })
          instanceof Event
      );
    });

    await t.test('5 - Conciliacion disponible', () => {
      assert.ok(
        payments.get(Reconciliation, { strict: true })
          instanceof Reconciliation
      );
    });

    await t.test('6 - Dependencias sustituidas', () => {
      assert.equal(context.get(PrismaService), prisma);
      assert.equal(
        context.get(StripeTestClientService),
        stripe
      );
    });

    await t.test('7 - Servicios no exportados', () => {
      const exported = Reflect.getMetadata(
        MODULE_METADATA.EXPORTS,
        PaymentsModule
      ) || [];

      for (const service of [
        Search, Account, Event, Reconciliation,
      ]) {
        assert.ok(!exported.includes(service));
      }
    });

    await t.test('8 - Conciliacion desactivada', async () => {
      const service = payments.get(
        Reconciliation, { strict: true }
      );

      await assert.rejects(
        service.inspectUncertainRequest(
          'invalid', 'invalid'
        ),
        error => error.getStatus() === 503
      );
    });

    await t.test('9 - Sin consultas a PostgreSQL', () => {
      assert.equal(databaseCalls, 0);
    });

    await t.test('10 - Sin conexiones a Stripe', () => {
      assert.equal(externalCalls, 0);
    });

  } finally {
    try {
      if (context) {
        await context.close();
      }
    } finally {
      if (previousMode === undefined) {
        delete process.env.STRIPE_MODE;
      } else {
        process.env.STRIPE_MODE = previousMode;
      }
    }
  }
});
