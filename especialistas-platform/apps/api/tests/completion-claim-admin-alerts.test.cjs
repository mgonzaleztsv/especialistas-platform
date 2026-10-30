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

const inicio = pagina.indexOf(
  '  function diasTranscurridos('
);

const fin = pagina.indexOf(
  '  function segundaRevisionVencida(',
  inicio
);

assert.ok(
  inicio >= 0 && fin > inicio,
  'No se encontraron las funciones de alertas'
);

// Compilar las funciones originales de la página.
// Las pruebas no utilizan copias reescritas de su lógica.
const funcionesTS = pagina.slice(inicio, fin);

const compilado = ts.transpileModule(
  funcionesTS,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.None
    },
    reportDiagnostics: true
  }
);

const diagnosticos = compilado.diagnostics || [];

assert.equal(
  diagnosticos.filter(
    d => d.category === ts.DiagnosticCategory.Error
  ).length,
  0,
  'Las funciones de alertas deben compilar'
);

const funciones = vm.runInNewContext(
  compilado.outputText +
  '\n({ diasTranscurridos, alertaAntiguedad, alertaSeguimientoPago })'
);

const {
  diasTranscurridos,
  alertaAntiguedad,
  alertaSeguimientoPago
} = funciones;

function haceDias(dias) {
  return new Date(
    Date.now() - dias * 24 * 60 * 60 * 1000
  ).toISOString();
}

function reclamacion(cambios = {}) {
  return {
    status: 'CORRECTION_REQUESTED',
    createdAt: haceDias(31),
    paymentPaidAt: haceDias(91),
    paymentStatus: 'PAID',
    ...cambios
  };
}

test('918.1 - Alerta de antigüedad después de 30 días', () => {
  assert.equal(
    alertaAntiguedad(
      reclamacion({ createdAt: haceDias(31) })
    ),
    true
  );

  assert.equal(
    alertaAntiguedad(
      reclamacion({ createdAt: haceDias(29) })
    ),
    false
  );
});

test('918.2 - No alerta por antigüedad en reclamaciones cerradas', () => {
  for (const status of ['RESOLVED', 'REJECTED']) {
    assert.equal(
      alertaAntiguedad(
        reclamacion({ status, createdAt: haceDias(40) })
      ),
      false
    );
  }
});

test('918.3 - La antigüedad no depende del estado de pago', () => {
  assert.equal(
    alertaAntiguedad(
      reclamacion({
        status: 'DISPUTED',
        paymentStatus: 'RELEASED'
      })
    ),
    true
  );
});

test('918.4 - Alerta financiera después de 90 días de cobro', () => {
  assert.equal(
    alertaSeguimientoPago(
      reclamacion({ paymentPaidAt: haceDias(91) })
    ),
    true
  );

  assert.equal(
    alertaSeguimientoPago(
      reclamacion({ paymentPaidAt: haceDias(89) })
    ),
    false
  );
});

test('918.5 - Un pago liberado no genera alerta financiera', () => {
  for (const status of ['RELEASED', 'PENDING']) {
    assert.equal(
      alertaSeguimientoPago(
        reclamacion({
          paymentStatus: status,
          paymentPaidAt: haceDias(100)
        })
      ),
      false
    );
  }
});

test('918.6 - Si no hay fecha de cobro, no hay alerta financiera', () => {
  assert.equal(
    alertaSeguimientoPago(
      reclamacion({ paymentPaidAt: null })
    ),
    false
  );

  assert.equal(diasTranscurridos(null), null);
  assert.equal(diasTranscurridos('fecha inválida'), null);
});

test('918.7 - Un pago todavía retenido exige seguimiento aunque se haya cerrado la reclamación', () => {
  assert.equal(
    alertaSeguimientoPago(
      reclamacion({
        status: 'RESOLVED',
        paymentStatus: 'PAID',
        paymentPaidAt: haceDias(100)
      })
    ),
    true
  );
});

test('918.8 - La consulta administrativa incluye estado y fecha de cobro', async () => {
  const registro = {
    consultas: 0,
    escrituras: 0,
    select: null
  };

  const fechaCobro = new Date('2026-07-01T12:00:00Z');

  const fila = {
    id: 'claim-918',
    jobRequestId: 'job-918',
    description: 'Reclamación de prueba',
    status: 'DISPUTED',
    specialistResponseNotes: null,
    specialistRespondedAt: null,
    correctionCompletedAt: null,
    correctionReviewDeadline: null,
    correctionCompletionNotes: null,
    clientCorrectionAcceptedAt: null,
    clientCorrectionRespondedAt: null,
    clientCorrectionResponseNotes: null,
    resolutionNotes: null,
    resolvedAt: null,
    createdAt: new Date('2026-08-01T12:00:00Z'),
    updatedAt: new Date('2026-08-01T12:00:00Z'),
    jobRequest: {
      id: 'job-918',
      title: 'Trabajo de prueba',
      status: 'AWAITING_CLIENT_CONFIRMATION',
      city: 'Chicago',
      state: 'IL',
      payment: {
        status: 'PAID',
        paidAt: fechaCobro
      },
      client: {
        user: {
          id: 'client-918',
          name: 'Cliente de prueba'
        }
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
        registro.select = args.select;
        return [fila];
      },
      updateMany: async () => {
        registro.escrituras++;
        throw new Error('No deben modificarse reclamaciones');
      }
    },
    payment: {
      updateMany: async () => {
        registro.escrituras++;
        throw new Error('No deben modificarse pagos');
      }
    }
  };

  const resultado =
    await controller.getAdminCompletionClaims();

  assert.equal(registro.consultas, 1);
  assert.equal(registro.escrituras, 0);

  assert.equal(
    registro.select.jobRequest.select.payment.select.status,
    true
  );

  assert.equal(
    registro.select.jobRequest.select.payment.select.paidAt,
    true
  );

  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].paymentStatus, 'PAID');
  assert.deepEqual(resultado[0].paymentPaidAt, fechaCobro);
});

test('918.9 - La consulta no interpreta una fecha de cobro inexistente', async () => {
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

  assert.match(
    consulta,
    /paymentPaidAt:\s*claim\.jobRequest\.payment\?\.paidAt\s*\?\?\s*null/
  );

  assert.match(
    consulta,
    /paymentStatus:\s*claim\.jobRequest\.payment\?\.status\s*\?\?\s*null/
  );

  assert.doesNotMatch(
    consulta,
    /payment\.update|payment\.create|releasedAt:\s*new Date/
  );
});
