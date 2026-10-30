const test = require('node:test');
const assert = require('node:assert/strict');

require('reflect-metadata');

const { GUARDS_METADATA } = require('@nestjs/common/constants');

const {
  AdminGuard
} = require('../dist/auth/admin.guard.js');

const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

function contexto(user) {
  return {
    switchToHttp() {
      return {
        getRequest() {
          return { user };
        }
      };
    }
  };
}

test('929.1 - ADMIN obtiene autorización', () => {
  const guard = new AdminGuard();

  assert.equal(
    guard.canActivate(contexto({ role: 'ADMIN' })),
    true
  );
});

test('929.2 - CLIENT no obtiene autorización', () => {
  const guard = new AdminGuard();

  assert.throws(
    () => guard.canActivate(contexto({ role: 'CLIENT' })),
    error => error.getStatus() === 403
  );
});

test('929.3 - SPECIALIST no obtiene autorización', () => {
  const guard = new AdminGuard();

  assert.throws(
    () => guard.canActivate(contexto({ role: 'SPECIALIST' })),
    error => error.getStatus() === 403
  );
});

test('929.4 - Usuario ausente no obtiene autorización', () => {
  const guard = new AdminGuard();

  for (const user of [null, undefined]) {
    assert.throws(
      () => guard.canActivate(contexto(user)),
      error => error.getStatus() === 403
    );
  }
});

test('929.5 - ADMIN debe coincidir exactamente', () => {
  const guard = new AdminGuard();

  for (const role of ['admin', '', null, 'SUPERADMIN']) {
    assert.throws(
      () => guard.canActivate(contexto({ role })),
      error => error.getStatus() === 403
    );
  }
});

const metodos = [
  'getAdminCompletionClaims',
  'resolveCompletionClaimByAdmin',
  'getAdminDamageClaims',
  'resolveDamageClaim',
  'getAdminTerminationRequests',
  'resolveTerminationByAdmin'
];

test('929.6 - Las seis rutas tienen JWT y AdminGuard', () => {
  const controller = JobRequestsController.prototype;

  for (const nombre of metodos) {
    const metodo = controller[nombre];

    assert.equal(
      typeof metodo,
      'function',
      `No se encontró ${nombre}`
    );

    const guards =
      Reflect.getMetadata(GUARDS_METADATA, metodo) || [];

    const nombres = guards.map(guard => guard.name);

    assert.ok(
      nombres.includes('JwtAuthGuard'),
      `${nombre}: falta JwtAuthGuard`
    );

    assert.ok(
      nombres.includes('AdminGuard'),
      `${nombre}: falta AdminGuard`
    );
  }
});

test('929.7 - El controlador conserva protección JWT general', () => {
  const guards =
    Reflect.getMetadata(GUARDS_METADATA, JobRequestsController) || [];

  assert.ok(
    guards.some(guard => guard.name === 'JwtAuthGuard')
  );
});
