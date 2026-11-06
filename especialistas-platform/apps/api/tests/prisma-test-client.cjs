'use strict';

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

function createTestPrismaClient() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL de pruebas no configurada');
  }

  const url = new URL(connectionString);

  if (
    !['postgresql:', 'postgres:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.port !== '5433' ||
    url.pathname !== '/connectpro_test'
  ) {
    throw new Error(
      'Prohibido conectar pruebas fuera de connectpro_test:5433'
    );
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

module.exports = { createTestPrismaClient };
