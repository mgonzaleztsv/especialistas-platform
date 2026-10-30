const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('reflect-metadata');

const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

const {
  PATH_METADATA,
  GUARDS_METADATA
} = require('@nestjs/common/constants');

const pagePath = path.resolve(
  __dirname,
  '../../web/app/admin/reclamaciones-finalizacion/page.tsx'
);

const sourcePath = path.resolve(
  __dirname,
  '../src/job-requests/job-requests.controller.ts'
);

const campos = [
  'correctionCompletedAt',
  'correctionReviewDeadline',
  'correctionCompletionNotes',
  'clientCorrectionAcceptedAt',
  'clientCorrectionRespondedAt',
  'clientCorrectionResponseNotes'
];

function crearControlador(filas = []) {
  const registro = {
    consultas: 0,
    modificaciones: 0,
    argumentos: null
  };

  const prisma = {
    completionClaim: {
      findMany: async args => {
        registro.consultas++;
        registro.argumentos = args;
        return filas;
      },
      update: async () => {
        registro.modificaciones++;
        throw new Error('No debe modificarse una reclamación');
      },
      updateMany: async () => {
        registro.modificaciones++;
        throw new Error('No debe modificarse una reclamación');
      }
    },
    jobRequest: {
      updateMany: async () => {
        registro.modificaciones++;
        throw new Error('No debe modificarse un trabajo');
      }
    },
    payment: {
      updateMany: async () => {
        registro.modificaciones++;
        throw new Error('No debe modificarse un pago');
      }
    }
  };

  const controller = Object.create(
    JobRequestsController.prototype
  );

  controller.prisma = prisma;

  return { controller, registro };
}

test('911.1 - La consulta administrativa exige autenticación y administrador', () => {
  const metodo =
    JobRequestsController.prototype.getAdminCompletionClaims;

  assert.equal(
    Reflect.getMetadata(PATH_METADATA, metodo),
    'admin/completion-claims'
  );

  const guards =
    Reflect.getMetadata(GUARDS_METADATA, metodo) || [];

  assert.ok(
    guards.some(guard => guard.name === 'JwtAuthGuard')
  );
  assert.ok(
    guards.some(guard => guard.name === 'AdminGuard')
  );
});

test('911.2 - La API solicita todos los campos del segundo período', async () => {
  const { controller, registro } = crearControlador();

  const resultado = await controller.getAdminCompletionClaims();

  assert.deepEqual(resultado, []);
  assert.equal(registro.consultas, 1);
  assert.equal(registro.modificaciones, 0);

  for (const campo of campos) {
    assert.equal(
      registro.argumentos.select[campo],
      true,
      'Falta campo en consulta: ' + campo
    );
  }

  assert.deepEqual(
    registro.argumentos.orderBy,
    { createdAt: 'desc' }
  );
});

test('911.3 - La API devuelve las fechas y explicaciones sin cambiarlas', async () => {
  const fechaCorreccion = new Date('2026-10-20T12:00:00Z');
  const fechaLimite = new Date('2026-10-22T12:00:00Z');

  const fila = {
    id: 'claim-911',
    jobRequestId: 'job-911',
    description: 'El trabajo presenta un defecto',
    status: 'CORRECTION_REQUESTED',
    specialistResponseNotes: 'Corregiré el defecto',
    specialistRespondedAt: new Date('2026-10-19T12:00:00Z'),
    correctionCompletedAt: fechaCorreccion,
    correctionReviewDeadline: fechaLimite,
    correctionCompletionNotes: 'Se reparó el defecto',
    clientCorrectionAcceptedAt: null,
    clientCorrectionRespondedAt: null,
    clientCorrectionResponseNotes: null,
    resolutionNotes: null,
    resolvedAt: null,
    createdAt: new Date('2026-10-18T12:00:00Z'),
    updatedAt: fechaCorreccion,
    jobRequest: {
      id: 'job-911',
      title: 'Reparación de prueba',
      status: 'AWAITING_CLIENT_CONFIRMATION',
      city: 'Chicago',
      state: 'IL',
      client: {
        user: {
          id: 'client-user-911',
          name: 'Cliente de prueba'
        }
      },
      proposals: [{
        specialist: {
          user: {
            id: 'specialist-user-911',
            name: 'Especialista de prueba'
          }
        }
      }]
    }
  };

  const { controller, registro } = crearControlador([fila]);
  const resultado = await controller.getAdminCompletionClaims();

  assert.equal(resultado.length, 1);

  const claim = resultado[0];

  assert.equal(claim.id, 'claim-911');
  assert.equal(claim.status, 'CORRECTION_REQUESTED');
  assert.deepEqual(
    claim.correctionCompletedAt,
    fechaCorreccion
  );
  assert.deepEqual(
    claim.correctionReviewDeadline,
    fechaLimite
  );
  assert.equal(
    claim.correctionCompletionNotes,
    'Se reparó el defecto'
  );
  assert.equal(claim.clientCorrectionRespondedAt, null);
  assert.equal(claim.jobRequest.title, 'Reparación de prueba');
  assert.equal(registro.modificaciones, 0);
});

test('911.4 - La pantalla incluye el historial del segundo período', () => {
  const codigo = fs.readFileSync(pagePath, 'utf8');

  for (const campo of campos) {
    assert.match(
      codigo,
      new RegExp('\\b' + campo + '\\b'),
      'Falta referencia en interfaz: ' + campo
    );
  }

  assert.match(codigo, /segundaRevisionVencida/);
  assert.match(codigo, /Seguimiento prioritario/);
  assert.match(codigo, /plazo vencido/i);
  assert.match(codigo, /liberar fondos/i);
});

test('911.5 - Solo una corrección sin respuesta puede considerarse vencida', () => {
  const codigo = fs.readFileSync(pagePath, 'utf8');

  const inicio = codigo.indexOf(
    'function segundaRevisionVencida(claim: Claim)'
  );
  const fin = codigo.indexOf(
    'function puedeResolver(',
    inicio
  );

  assert.ok(inicio >= 0 && fin > inicio);

  const funcion = codigo.slice(inicio, fin);

  assert.match(funcion, /CORRECTION_REQUESTED/);
  assert.match(funcion, /correctionCompletedAt/);
  assert.match(funcion, /correctionReviewDeadline/);
  assert.match(funcion, /clientCorrectionRespondedAt/);
  assert.match(funcion, /Date\.now\(\)/);

  const prioridad = codigo.indexOf(
    'Number(segundaRevisionVencida(b))'
  );

  assert.ok(
    prioridad >= 0,
    'Las correcciones vencidas deben aparecer primero'
  );
});

test('911.6 - La consulta no incorpora decisiones financieras', () => {
  const codigo = fs.readFileSync(sourcePath, 'utf8');

  const inicio = codigo.indexOf(
    "  @Get('admin/completion-claims')"
  );

  const fin = codigo.indexOf(
    "  @Post(':id/completion-claims/:claimId/resolve')",
    inicio
  );

  assert.ok(inicio >= 0 && fin > inicio);

  const consulta = codigo.slice(inicio, fin);

  assert.doesNotMatch(
    consulta,
    /payment\.update|jobRequest\.update|completionClaim\.update/
  );

  assert.doesNotMatch(
    consulta,
    /status:\s*['"]RELEASED['"]/
  );
});
