const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { URL } = require('node:url');

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('Falta DATABASE_URL');

  const url = new URL(raw);

  if (
    url.hostname !== 'localhost' ||
    url.port !== '5433' ||
    url.pathname !== '/connectpro_test' ||
    url.username !== 'connectpro_test'
  ) {
    throw new Error('SEGURIDAD: Base de datos no autorizada');
  }

  const prisma = new PrismaClient();
  try {
    const database = await prisma.$queryRaw`
      SELECT current_database() AS name,
             inet_server_port() AS port
    `;
    assert.equal(database[0].name, 'connectpro_test');

    const category = await prisma.category.findFirst({
      where: { slug: 'plomeria' }
    });
    assert.ok(category, 'Falta categoría de plomería');

    const passwordHash = await bcrypt.hash(
      'ConnectProTest2026!',
      12
    );

    const client = await prisma.user.upsert({
      where: { email: 'cliente.integration@connectpro.test' },
      update: {},
      create: {
        name: 'Cliente Prueba ConnectPro',
        email: 'cliente.integration@connectpro.test',
        passwordHash,
        role: 'CLIENT',
        client: { create: {} }
      },
      include: { client: true }
    });

    const specialist = await prisma.user.upsert({
      where: { email: 'especialista.integration@connectpro.test' },
      update: {},
      create: {
        name: 'Especialista Prueba ConnectPro',
        email: 'especialista.integration@connectpro.test',
        passwordHash,
        role: 'SPECIALIST',
        specialist: { create: {} }
      },
      include: { specialist: true }
    });

    assert.ok(client.client, 'Cliente sin perfil');
    assert.ok(specialist.specialist, 'Especialista sin perfil');

    console.log('CORRECTO - Cliente de prueba creado');
    console.log('CORRECTO - Especialista de prueba creado');
    console.log('CORRECTO - Perfiles relacionados');
    console.log('CORRECTO - Categoría disponible');
    console.log('Base utilizada: connectpro_test');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('ERROR:', error.message);
  process.exitCode = 1;
});
