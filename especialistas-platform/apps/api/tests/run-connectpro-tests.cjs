'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TEST_DIRECTORY = __dirname;

const GROUPS = {
  security: [
    'admin-access-security.test.cjs',
    'cors-security.test.cjs',
    'http-security.test.cjs',
    'service-history-security.test.cjs'
  ],
  messaging: [
    'private-messaging.test.cjs',
    'private-messaging-http.test.cjs'
  ],
  financialSafety: [
    'payment-safety.test.cjs',
    'stripe-webhook-signature.test.cjs'
  ],
  stripeReconciliation: [
    'stripe-account-creation-identity.test.cjs',
    'stripe-account-creation-evidence.test.cjs',
    'stripe-account-event-evidence.test.cjs',
    'stripe-account-candidate-search.test.cjs',
    'stripe-account-evidence-time.test.cjs',
    'stripe-account-reconciliation-evaluator.test.cjs',
    'stripe-account-reconciliation.test.cjs',
    'stripe-reconciliation-module.test.cjs'
  ]
};


function validateTestEnvironment(env) {
  const connectionString = env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL no configurada');
  }

  const url = new URL(connectionString);

  if (
    !['postgresql:', 'postgres:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.port !== '5433' ||
    url.pathname !== '/connectpro_test' ||
    url.username !== 'connectpro_test'
  ) {
    throw new Error(
      'Conexión prohibida: usar solamente connectpro_test:5433'
    );
  }

  if (env.NODE_ENV !== 'test') {
    throw new Error(
      'NODE_ENV debe ser test'
    );
  }

  return true;
}

function createSafeTestEnvironment(source) {
  const env = { ...source };

  env.NODE_ENV = 'test';
  env.INTERNAL_MVP_PAYMENTS_ENABLED = 'false';
  env.WORK_ORDER_EXPIRATION_ENABLED = 'false';

  for (const key of Object.keys(env)) {
    if (/^STRIPE_/i.test(key)) {
      delete env[key];
    }
  }

  validateTestEnvironment(env);

  return env;
}


function runTestGroup(group) {
  const { spawnSync } = require('node:child_process');
  const crypto = require('node:crypto');

  console.log('===== CONNECTPRO: GRUPO ' + group + ' =====');

  const envFile = path.resolve(
    TEST_DIRECTORY, '../../../.env.test'
  );

  if (!fs.existsSync(envFile)) {
    throw new Error('No existe .env.test');
  }

  const env = { ...process.env };
  const content = fs.readFileSync(envFile, 'utf8');

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) continue;

    const index = trimmed.indexOf('=');
    if (index < 1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();

    env[key] = value.replace(/^["']|["']$/g, '');
  }

  env.NODE_ENV = 'test';
  env.JWT_SECRET = crypto.randomBytes(48).toString('hex');

  const safeEnv = createSafeTestEnvironment(env);

  console.log('CORRECTO - Entorno aislado');
  console.log('CORRECTO - Pagos internos desactivados');


  if (!['security', 'messaging', 'financialSafety', 'stripeReconciliation'].includes(group)) {
    throw new Error('Grupo no autorizado');
  }

  const files = GROUPS[group];
  let passed = 0;

  for (const file of files) {
    const fullPath = path.join(TEST_DIRECTORY, file);

    if (!fs.existsSync(fullPath)) {
      throw new Error('Prueba no encontrada: ' + file);
    }

    console.log();
    console.log('===== EJECUTANDO:', file, '=====');

    const result = spawnSync(
      process.execPath,
      [fullPath],
      {
        env: safeEnv,
        stdio: 'inherit',
        timeout: 90000
      }
    );

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error('Prueba fallida: ' + file);
    }

    passed++;
    console.log('CORRECTO -', file);
  }

  console.log();
  console.log('===== RESUMEN ' + group + ' =====');
  console.log('Archivos previstos:', files.length);
  console.log('Archivos superados:', passed);
  console.log('CORRECTO - Grupo ' + group + ' completado');

}

function showInventory() {
  console.log('===== CONNECTPRO: EJECUTOR DE PRUEBAS =====');
  console.log('Modo: INVENTARIO');

  let total = 0;
  let missing = 0;

  for (const [group, files] of Object.entries(GROUPS)) {
    console.log();
    console.log('GRUPO:', group);

    for (const file of files) {
      const exists = fs.existsSync(
        path.join(TEST_DIRECTORY, file)
      );

      console.log(
        exists ? 'DISPONIBLE -' : 'FALTANTE -',
        file
      );

      total++;

      if (!exists) missing++;
    }
  }

  console.log();
  console.log('Archivos revisados:', total);
  console.log('Archivos faltantes:', missing);
  console.log('No se ejecutaron pruebas.');

  if (missing) process.exitCode = 1;
}


const args = process.argv.slice(2);

if (args.length === 1 && args[0] === '--list') {
  showInventory();

} else if (
  args.length === 2 &&
  args[0] === '--run' &&
  ['security', 'messaging', 'financialSafety', 'stripeReconciliation'].includes(args[1])
) {
  runTestGroup(args[1]);

} else {
  console.error(
    'Uso: --list o --run security|messaging|financialSafety|stripeReconciliation'
  );
  process.exitCode = 1;
}
