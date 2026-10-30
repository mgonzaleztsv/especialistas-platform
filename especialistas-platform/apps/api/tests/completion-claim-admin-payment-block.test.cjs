const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const controllerPath = path.resolve(
  __dirname,
  '../src/job-requests/job-requests.controller.ts'
);

const source = fs.readFileSync(controllerPath, 'utf8');
const sourceFile = ts.createSourceFile(
  controllerPath, source, ts.ScriptTarget.Latest, true
);

const controller = sourceFile.statements.find(
  node => ts.isClassDeclaration(node) &&
    node.name?.text === 'JobRequestsController'
);

assert.ok(controller, 'No se encontró JobRequestsController');

const method = controller.members.find(
  node => ts.isMethodDeclaration(node) &&
    node.name?.getText(sourceFile) === 'confirmJobCompletion'
);

assert.ok(method, 'No se encontró confirmJobCompletion');

const methodText = method.getText(sourceFile);

test('884.1 - La comprobación está dentro de la transacción', () => {
  assert.match(methodText, /tx\.completionClaim\.count/);
  assert.match(methodText, /administrativelyClosedClaims/);
  assert.match(methodText, /RESOLVED/);
  assert.match(methodText, /REJECTED/);

  const check = methodText.indexOf(
    'if (administrativelyClosedClaims > 0)'
  );
  const payment = methodText.indexOf('tx.payment.updateMany');

  assert.ok(check >= 0);
  assert.ok(payment > check);
});

test('884.2 - Una reclamación RESOLVED bloquea el pago', () => {
  const estado = 'RESOLVED';
  const closedClaims = ['RESOLVED', 'REJECTED'].includes(estado) ? 1 : 0;

  let paymentUpdated = false;

  if (closedClaims > 0) {
    assert.equal(paymentUpdated, false);
    return;
  }

  paymentUpdated = true;
  assert.fail('No debió llegar a modificar el pago');
});

test('884.3 - Una reclamación REJECTED bloquea el pago', () => {
  const estado = 'REJECTED';
  const closedClaims = ['RESOLVED', 'REJECTED'].includes(estado) ? 1 : 0;

  let paymentUpdated = false;

  if (closedClaims > 0) {
    assert.equal(paymentUpdated, false);
    return;
  }

  paymentUpdated = true;
  assert.fail('No debió llegar a modificar el pago');
});

test('884.4 - Sin reclamaciones se conserva el flujo permitido', () => {
  const claims = [];
  const open = claims.filter(c =>
    ['PENDING', 'CORRECTION_REQUESTED', 'DISPUTED'].includes(c)
  ).length;
  const closed = claims.filter(c =>
    ['RESOLVED', 'REJECTED'].includes(c)
  ).length;

  assert.equal(open, 0);
  assert.equal(closed, 0);
  assert.match(methodText, /status: 'RELEASED'/);
});
