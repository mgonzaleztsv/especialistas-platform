require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Test } = require('@nestjs/testing');
const { MODULE_METADATA } = require('@nestjs/common/constants');

const {
  PaymentsModule,
} = require('../dist/payments/payments.module.js');

const {
  StripeAccountCreationService,
} = require('../dist/payments/stripe-account-creation.service.js');

const {
  StripeAccountCreationRequestService,
} = require('../dist/payments/stripe-account-creation-request.service.js');

const {
  StripeTestClientService,
} = require('../dist/payments/stripe-test-client.service.js');

const {
  PrismaService,
} = require('../dist/prisma/prisma.service.js');

const {
  StripeWebhookController,
} = require('../dist/payments/stripe-webhook.controller.js');

test('Stripe: integracion interna de creacion externa', async (t) => {
  const previousMode = process.env.STRIPE_MODE;

  process.env.STRIPE_MODE = 'disabled';

  let moduleRef;
  let clientCalls = 0;
  let databaseCalls = 0;
  let externalCalls = 0;

  const prisma = new Proxy({}, {
    get(target, property) {
      if ([
        'then',
        'onModuleInit',
        'onModuleDestroy',
        'beforeApplicationShutdown',
        'onApplicationShutdown',
        'onApplicationBootstrap',
      ].includes(property)) {
        return undefined;
      }

      if (typeof property === 'symbol') {
        return undefined;
      }

      if (property === 'constructor') {
        return Object;
      }

      databaseCalls++;

      throw new Error(
        'Database access prohibited in module test'
      );
    },
  });

  const stripe = {
    getClient() {
      clientCalls++;

      return {
        accounts: {
          async create() {
            externalCalls++;

            throw new Error(
              'External creation prohibited in module test'
            );
          },
        },
      };
    },
  };

  try {
    const providers =
      Reflect.getMetadata(
        MODULE_METADATA.PROVIDERS,
        PaymentsModule
      ) || [];

    const exports =
      Reflect.getMetadata(
        MODULE_METADATA.EXPORTS,
        PaymentsModule
      ) || [];

    const controllers =
      Reflect.getMetadata(
        MODULE_METADATA.CONTROLLERS,
        PaymentsModule
      ) || [];

    await t.test('1 - Servicio registrado una sola vez', () => {
      assert.equal(
        providers.filter(
          p => p === StripeAccountCreationService
        ).length,
        1
      );
    });

    await t.test('2 - Servicio no exportado', () => {
      assert.ok(
        !exports.includes(StripeAccountCreationService)
      );
    });

    await t.test('3 - Dependencia de solicitudes registrada', () => {
      assert.ok(
        providers.includes(
          StripeAccountCreationRequestService
        )
      );
    });

    await t.test('4 - Dependencia de cliente registrada', () => {
      assert.ok(
        providers.includes(StripeTestClientService)
      );
    });

    await t.test('5 - Controladores existentes conservados', () => {
      assert.deepEqual(
        controllers,
        [StripeWebhookController]
      );
    });

    await t.test('6 - Compilacion del modulo NestJS', async () => {
      moduleRef = await Test.createTestingModule({
        imports: [PaymentsModule],
      })
        .overrideProvider(PrismaService)
        .useValue(prisma)
        .overrideProvider(StripeTestClientService)
        .useValue(stripe)
        .compile();

      assert.ok(moduleRef);
    });

    await t.test('7 - Servicio interno disponible', () => {
      assert.ok(moduleRef);

      const service = moduleRef
        .select(PaymentsModule)
        .get(StripeAccountCreationService, {
          strict: true,
        });

      assert.ok(
        service instanceof StripeAccountCreationService
      );

      assert.equal(
        typeof service.processRegisteredRequest,
        'function'
      );
    });

    await t.test('8 - Modo desactivado bloquea ejecucion', async () => {
      assert.ok(moduleRef);

      const service =
        moduleRef.get(StripeAccountCreationService);

      await assert.rejects(
        service.processRegisteredRequest(
          'temporary-test-specialist'
        ),
        error => error.getStatus() === 503
      );

      assert.equal(clientCalls, 0);
    });

    await t.test('9 - Modo real bloquea ejecucion', async () => {
      assert.ok(moduleRef);

      const service =
        moduleRef.get(StripeAccountCreationService);

      process.env.STRIPE_MODE = 'live';

      try {
        await assert.rejects(
          service.processRegisteredRequest(
            'temporary-test-specialist'
          ),
          error => error.getStatus() === 503
        );
      } finally {
        process.env.STRIPE_MODE = 'disabled';
      }

      assert.equal(clientCalls, 0);
    });

    await t.test('10 - Sin operaciones externas ni consultas DB', async () => {
      assert.ok(moduleRef);

      await moduleRef.close();
      moduleRef = undefined;

      assert.equal(clientCalls, 0);
      assert.equal(databaseCalls, 0);
      assert.equal(externalCalls, 0);
    });

  } finally {
    try {
      if (moduleRef) {
        await moduleRef.close();
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
