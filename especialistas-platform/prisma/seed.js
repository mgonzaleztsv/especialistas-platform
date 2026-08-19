const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const categories = [
    ['Plomería', 'plomeria'],
    ['Electricidad', 'electricidad'],
    ['Carpintería', 'carpinteria'],
    ['Pintura', 'pintura'],
    ['HVAC / Climatización', 'hvac'],
    ['Limpieza', 'limpieza'],
    ['Jardinería', 'jardineria'],
    ['Mudanzas', 'mudanzas'],
    ['Reparaciones generales', 'reparaciones-generales'],
    ['Construcción', 'construccion']
  ];

  for (const [name, slug] of categories) {
    await prisma.category.upsert({
      where: { slug },
      update: { name, active: true },
      create: { name, slug, active: true }
    });
  }

  console.log('Se cargaron 10 categorías.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
