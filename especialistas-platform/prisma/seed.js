const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const categories = [
    ['Plomería','plomeria'],
    ['Electricidad','electricidad'],
    ['HVAC','hvac'],
    ['Pintura','pintura'],
    ['Reparaciones generales','reparaciones-generales'],
    ['Limpieza','limpieza']
  ];
  for (const [name, slug] of categories) {
    await prisma.category.upsert({
      where: { slug },
      update: { name, active: true },
      create: { name, slug }
    });
  }
  console.log('Categorías iniciales creadas.');
}

main().finally(() => prisma.$disconnect());
