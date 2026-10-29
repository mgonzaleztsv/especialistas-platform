
require('reflect-metadata');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  Controller,
  Get,
  Module
} = require('@nestjs/common');

const { NestFactory } = require('@nestjs/core');

class HealthController {
  check() {
    return { isolated: true, database: false };
  }
}

Controller('test')(HealthController);
Get('health')(
  HealthController.prototype,
  'check',
  Object.getOwnPropertyDescriptor(
    HealthController.prototype, 'check'
  )
);

class TestModule {}

Module({
  controllers: [HealthController],
  providers: []
})(TestModule);

test('694.1 - NestJS HTTP aislado funciona', async () => {
  const app = await NestFactory.create(TestModule, {
    logger: false
  });

  try {
    await app.listen(0, '127.0.0.1');

    const address = app.getHttpServer().address();

    assert.ok(address);
    assert.ok(address.port > 0);

    const response = await fetch(
      `http://127.0.0.1:${address.port}/test/health`
    );

    assert.equal(response.status, 200);

    const body = await response.json();

    assert.deepEqual(body, {
      isolated: true,
      database: false
    });
  } finally {
    await app.close();
  }
});


const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

const {
  JwtAuthGuard
} = require('../dist/common/guards/jwt-auth.guard.js');

const { Test } = require('@nestjs/testing');
const {
  PrismaService
} = require('../dist/prisma/prisma.service.js');

const CLIENT = 'cliente-test';
const SPECIALIST = 'especialista-test';
const OUTSIDER = 'tercero-test';

function makePrisma() {
  const calls = { reads: 0, writes: 0, updates: 0 };

  const prisma = {
    jobRequest: {
      findFirst: async () => ({
        client: { userId: CLIENT },
        proposals: [{
          id: 'propuesta-test',
          specialist: {
            id: 'perfil-test',
            userId: SPECIALIST
          }
        }]
      })
    },
    message: {
      findMany: async () => {
        calls.reads++;
        return [{ id: 'mensaje-test', body: 'Hola' }];
      },
      updateMany: async () => {
        calls.updates++;
        return { count: 1 };
      },
      create: async ({ data }) => {
        calls.writes++;
        return { id: 'mensaje-nuevo', ...data };
      }
    },
    payment: {
      findUnique: async () => null
    }
  };

  return { prisma, calls };
}

async function createMessagingApp() {
  const { prisma, calls } = makePrisma();

  class MessagingTestModule {}

  Module({
    controllers: [JobRequestsController],
    providers: [
      { provide: PrismaService, useValue: prisma }
    ]
  })(MessagingTestModule);

  const moduleRef = await Test.createTestingModule({
    imports: [MessagingTestModule]
  })
  .overrideGuard(JwtAuthGuard)
  .useValue({
    canActivate(context) {
      const req = context.switchToHttp().getRequest();
      const userId = req.headers['x-test-user'];

      if (!userId) {
        return false;
      }

      req.user = { userId };
      return true;
    }
  })
  .overrideProvider(PrismaService)
  .useValue(prisma)
  .compile();

  const app = moduleRef.createNestApplication({
    logger: false
  });

  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');

  const port = app.getHttpServer().address().port;

  return {
    app,
    calls,
    base: `http://127.0.0.1:${port}/api/v1`
  };
}

async function http(base, method, userId, body) {
  const headers = { 'Content-Type': 'application/json' };

  if (userId) {
    headers['x-test-user'] = userId;
  }

  const options = { method, headers };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(
    `${base}/job-requests/trabajo-test/messages`,
    options
  );

  return {
    status: response.status,
    body: await response.json()
  };
}

test('695.1 - Cliente autorizado puede leer HTTP 200', async () => {
  const ctx = await createMessagingApp();
  try {
    const r = await http(ctx.base, 'GET', CLIENT);
    assert.equal(r.status, 200);
    assert.equal(ctx.calls.reads, 1);
  } finally {
    await ctx.app.close();
  }
});

test('695.2 - Especialista puede leer HTTP 200', async () => {
  const ctx = await createMessagingApp();
  try {
    const r = await http(ctx.base, 'GET', SPECIALIST);
    assert.equal(r.status, 200);
  } finally {
    await ctx.app.close();
  }
});

test('695.3 - Tercero no puede leer HTTP 403', async () => {
  const ctx = await createMessagingApp();
  try {
    const r = await http(ctx.base, 'GET', OUTSIDER);
    assert.equal(r.status, 403);
    assert.equal(ctx.calls.reads, 0);
    assert.equal(ctx.calls.updates, 0);
  } finally {
    await ctx.app.close();
  }
});

test('695.4 - Cliente autorizado puede enviar HTTP 201', async () => {
  const ctx = await createMessagingApp();
  try {
    const r = await http(ctx.base, 'POST', CLIENT, {
      body: 'Mensaje de prueba'
    });
    assert.equal(r.status, 201);
    assert.equal(ctx.calls.writes, 1);
  } finally {
    await ctx.app.close();
  }
});

test('695.5 - Especialista puede enviar HTTP 201', async () => {
  const ctx = await createMessagingApp();
  try {
    const r = await http(ctx.base, 'POST', SPECIALIST, {
      body: 'Respuesta de prueba'
    });
    assert.equal(r.status, 201);
    assert.equal(ctx.calls.writes, 1);
  } finally {
    await ctx.app.close();
  }
});

test('695.6 - Tercero no puede enviar HTTP 403', async () => {
  const ctx = await createMessagingApp();
  try {
    const r = await http(ctx.base, 'POST', OUTSIDER, {
      body: 'Acceso indebido'
    });
    assert.equal(r.status, 403);
    assert.equal(ctx.calls.writes, 0);
  } finally {
    await ctx.app.close();
  }
});

test('695.7 - Sin autenticación se rechaza acceso', async () => {
  const ctx = await createMessagingApp();
  try {
    const r = await http(ctx.base, 'GET', null);
    assert.equal(r.status, 403);
    assert.equal(ctx.calls.reads, 0);
  } finally {
    await ctx.app.close();
  }
});

test('695.8 - Mensaje vacío produce HTTP 400', async () => {
  const ctx = await createMessagingApp();
  try {
    const r = await http(ctx.base, 'POST', CLIENT, {
      body: '   '
    });
    assert.equal(r.status, 400);
    assert.equal(ctx.calls.writes, 0);
  } finally {
    await ctx.app.close();
  }
});
