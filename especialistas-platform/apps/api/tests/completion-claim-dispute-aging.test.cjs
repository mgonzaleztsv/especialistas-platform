const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

require('reflect-metadata');

const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

const pagina = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../web/app/admin/reclamaciones-finalizacion/page.tsx'
  ),
  'utf8'
);

// Ejecutar las funciones originales de la pantalla,
// sin reconstruir su lógica en las pruebas.
const inicio = pagina.indexOf(
  '  function diasTranscurridos('
);

const fin = pagina.indexOf(
  '  function segundaRevisionVencida(',
  inicio
);

assert.ok(
  inicio >= 0 && fin > inicio,
  'No se encontraron las funciones de seguimiento'
);

const fuente = pagina.slice(inicio, fin);

assert.match(
  fuente,
  /function alertaDisputa30Dias\(claim: Claim\)/
);

const compilacion = ts.transpileModule(
  fuente,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.None
    },
    reportDiagnostics: true
  }
);

assert.equal(
  (compilacion.diagnostics || []).filter(
    x => x.category === ts.DiagnosticCategory.Error
  ).length,
  0
);

const funciones = vm.runInNewContext(
  compilacion.outputText +
  '\n({ diasTranscurridos, alertaAntiguedad, ' +
  'alertaDisputa30Dias, alertaSeguimientoPago })'
);

function haceDias(dias) {
  return new Date(
    Date.now() - dias * 24 * 60 * 60 * 1000
  ).toISOString();
}

function reclamacion(cambios = {}) {
  return {
    status: 'DISPUTED',
    createdAt: haceDias(60),
    disputedAt: haceDias(31),
    paymentStatus: 'PAID',
    paymentPaidAt: haceDias(91),
    ...cambios
  };
}

test('924.1 - Disputa abierta de más de 30 días genera alerta', () => {
  assert.equal(
    funciones.alertaDisputa30Dias(reclamacion()),
    true
  );
});

test('924.2 - Disputa reciente no genera alerta', () => {
  assert.equal(
    funciones.alertaDisputa30Dias(
      reclamacion({ disputedAt: haceDias(29) })
    ),
    false
  );
});

test('924.3 - Reclamación antigua no significa disputa antigua', () => {
  const claim = reclamacion({
    createdAt: haceDias(80),
    disputedAt: haceDias(4)
  });

  assert.equal(funciones.alertaAntiguedad(claim), true);
  assert.equal(funciones.alertaDisputa30Dias(claim), false);
});

test('924.4 - No genera alerta de disputa tras cerrarla', () => {
  for (const status of ['RESOLVED', 'REJECTED']) {
    assert.equal(
      funciones.alertaDisputa30Dias(
        reclamacion({
          status,
          disputedAt: haceDias(45)
        })
      ),
      false
    );
  }
});

test('924.5 - Disputas históricas sin fecha no generan una fecha inventada', () => {
  assert.equal(
    funciones.alertaDisputa30Dias(
      reclamacion({ disputedAt: null })
    ),
    false
  );

  assert.equal(funciones.diasTranscurridos(null), null);

  assert.match(
    pagina,
    /La fecha de inicio de esta disputa no está/
  );
});

test('924.6 - Fecha futura o inválida no genera alerta', () => {
  const futura = new Date(
    Date.now() + 86400000
  ).toISOString();

  for (const disputedAt of [futura, 'fecha-inválida']) {
    assert.equal(
      funciones.alertaDisputa30Dias(
        reclamacion({ disputedAt })
      ),
      false
    );
  }
});

test('924.7 - Alerta de 90 días sigue siendo independiente', () => {
  const claim = reclamacion({
    disputedAt: haceDias(5),
    paymentPaidAt: haceDias(95)
  });

  assert.equal(
    funciones.alertaDisputa30Dias(claim),
    false
  );

  assert.equal(
    funciones.alertaSeguimientoPago(claim),
    true
  );
});

test('924.8 - API devuelve disputedAt sin modificar datos', async () => {
  const fecha = new Date('2026-10-01T12:00:00Z');
  const registro = {
    consultas: 0,
    escrituras: 0,
    seleccion: null
  };

  const fila = {
    id: 'claim-924',
    jobRequestId: 'job-924',
    description: 'Reclamación de prueba',
    status: 'DISPUTED',
    specialistResponseNotes: 'El especialista disputó',
    specialistRespondedAt: fecha,
    disputedAt: fecha,
    correctionCompletedAt: null,
    correctionReviewDeadline: null,
    correctionCompletionNotes: null,
    clientCorrectionAcceptedAt: null,
    clientCorrectionRespondedAt: null,
    clientCorrectionResponseNotes: null,
    resolutionNotes: null,
    resolvedAt: null,
    createdAt: fecha,
    updatedAt: fecha,
    jobRequest: {
      id: 'job-924',
      title: 'Trabajo temporal de prueba',
      status: 'AWAITING_CLIENT_CONFIRMATION',
      city: 'Chicago',
      state: 'IL',
      payment: null,
      client: {
        user: { id: 'user-924', name: 'Cliente prueba' }
      },
      proposals: []
    }
  };

  const controller = Object.create(
    JobRequestsController.prototype
  );

  controller.prisma = {
    completionClaim: {
      findMany: async args => {
        registro.consultas++;
        registro.seleccion = args.select;
        return [fila];
      },
      updateMany: async () => {
        registro.escrituras++;
        throw new Error('No se permite modificar reclamaciones');
      }
    },
    payment: {
      updateMany: async () => {
        registro.escrituras++;
        throw new Error('No se permite modificar pagos');
      }
    }
  };

  const datos = await controller.getAdminCompletionClaims();

  assert.equal(registro.consultas, 1);
  assert.equal(registro.escrituras, 0);
  assert.equal(registro.seleccion.disputedAt, true);
  assert.equal(datos.length, 1);
  assert.deepEqual(datos[0].disputedAt, fecha);
  assert.equal(datos[0].paymentPaidAt, null);
});

test('924.9 - La consulta no establece resoluciones automáticas', () => {
  const source = fs.readFileSync(
    path.resolve(
      __dirname,
      '../src/job-requests/job-requests.controller.ts'
    ),
    'utf8'
  );

  const inicio = source.indexOf(
    "  @Get('admin/completion-claims')"
  );
  const fin = source.indexOf(
    "  @Post(':id/completion-claims/:claimId/resolve')",
    inicio
  );

  assert.ok(inicio >= 0 && fin > inicio);

  const consulta = source.slice(inicio, fin);

  assert.match(consulta, /disputedAt: true/);
  assert.match(
    consulta,
    /disputedAt:\s*claim\.disputedAt/
  );

  assert.doesNotMatch(
    consulta,
    /completionClaim\.(update|delete|create)/
  );

  assert.doesNotMatch(
    consulta,
    /payment\.(update|create)/
  );
});
