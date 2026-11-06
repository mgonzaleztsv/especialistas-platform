const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

const dburl = new URL(process.env.DATABASE_URL || 'postgresql://invalid');

if (
  !['localhost', '127.0.0.1'].includes(dburl.hostname) ||
  dburl.port !== '5433' ||
  dburl.pathname !== '/connectpro_test'
) {
  throw Error('ALTO: Base de pruebas incorrecta');
}

const prisma = new PrismaClient();
const rollback = new Error('ROLLBACK_INTENCIONAL');

test('1017: historial real, permisos y pagos', async () => {
  const suffix = crypto.randomUUID().replace(/-/g, '');
  const ids = [];

  try {
    await prisma.$transaction(async tx => {
      async function user(name, role) {
        return tx.user.create({
          data: {
            name,
            email: `${suffix}-${ids.length}@example.invalid`,
            passwordHash: 'TEST_NO_VALID_PASSWORD',
            role,
          },
        });
      }

      const uc1 = await user('Cliente Uno', 'CLIENT');
      ids.push(uc1.id);
      const uc2 = await user('Cliente Ajeno', 'CLIENT');
      ids.push(uc2.id);
      const us1 = await user('Especialista Uno', 'SPECIALIST');
      ids.push(us1.id);
      const us2 = await user('Especialista Ajeno', 'SPECIALIST');
      ids.push(us2.id);

      const c1 = await tx.client.create({
        data: { userId: uc1.id }
      });
      const c2 = await tx.client.create({
        data: { userId: uc2.id }
      });
      const s1 = await tx.specialist.create({
        data: { userId: us1.id }
      });
      const s2 = await tx.specialist.create({
        data: { userId: us2.id }
      });

      const category = await tx.category.create({
        data: {
          name: 'Prueba historial ' + suffix,
          slug: 'test-history-' + suffix,
        },
      });

      async function createJob(
        title, client, specialist, status, amount, withPayment
      ) {
        const job = await tx.jobRequest.create({
          data: {
            clientId: client.id,
            categoryId: category.id,
            title,
            description: 'Servicio ficticio de prueba',
            city: 'Chicago',
            state: 'IL',
            status,
          },
        });

        const proposal = await tx.proposal.create({
          data: {
            jobRequestId: job.id,
            specialistId: specialist.id,
            amount,
            status: 'ACCEPTED',
          },
        });

        await tx.workOrder.create({
          data: {
            jobRequestId: job.id,
            proposalId: proposal.id,
            version: 1,
            title,
            description: 'Orden ficticia',
            city: 'Chicago',
            state: 'IL',
            laborAmount: amount - 20,
            materialsAmount: 20,
            status: 'ACCEPTED',
          },
        });

        if (withPayment) {
          await tx.payment.create({
            data: {
              jobRequestId: job.id,
              proposalId: proposal.id,
              clientId: client.id,
              specialistId: specialist.id,
              amount,
              status: 'RELEASED',
              provider: 'INTERNAL_MVP',
              paidAt: new Date(),
              releasedAt: new Date(),
            },
          });
        }

        return job;
      }

      await createJob(
        'Plomería', c1, s1, 'COMPLETED', 150, true
      );
      await createJob(
        'Electricidad', c1, s1, 'CANCELLED', 100, false
      );
      await createJob(
        'Servicio ajeno', c2, s2, 'COMPLETED', 200, true
      );

      const controller = new JobRequestsController(tx);

      const history = async id =>
        controller.serviceHistory({
          user: { userId: id }
        });

      const clientHistory = await history(uc1.id);
      const specialistHistory = await history(us1.id);
      const outsiderHistory = await history(uc2.id);
      const outsiderSpecialist = await history(us2.id);

      assert.equal(clientHistory.length, 2);
      assert.equal(specialistHistory.length, 2);
      assert.equal(outsiderHistory.length, 1);
      assert.equal(outsiderSpecialist.length, 1);

      assert.ok(
        clientHistory.every(x => x.title !== 'Servicio ajeno')
      );
      assert.ok(
        specialistHistory.every(x => x.title !== 'Servicio ajeno')
      );

      const paid = clientHistory.find(x => x.title === 'Plomería');
      const cancelled = clientHistory.find(
        x => x.title === 'Electricidad'
      );

      assert.equal(paid.agreedAmount, 150);
      assert.equal(paid.paymentAmount, 150);
      assert.equal(paid.paymentStatus, 'RELEASED');
      assert.equal(paid.counterpartName, 'Especialista Uno');

      assert.equal(cancelled.agreedAmount, 100);
      assert.equal(cancelled.paymentAmount, null);
      assert.equal(cancelled.paymentStatus, null);

      for (const entry of [
        ...clientHistory,
        ...specialistHistory,
        ...outsiderHistory,
        ...outsiderSpecialist,
      ]) {
        const text = JSON.stringify(entry);
        for (const field of [
          'serviceAddress', 'email', 'phone',
          'passwordHash', 'latitude', 'longitude'
        ]) {
          assert.ok(!text.includes('"' + field + '"'));
        }
      }

      console.log('CORRECTO - Historial cliente: 2 servicios');
      console.log('CORRECTO - Historial especialista: 2 servicios');
      console.log('CORRECTO - Usuarios ajenos aislados');
      console.log('CORRECTO - Precios y pagos verificados');
      console.log('CORRECTO - Datos privados excluidos');

      throw rollback;
    }, { timeout: 20000 });

    throw Error('La transacción no fue revertida');
  } catch (error) {
    if (error !== rollback) throw error;

    const remaining = await prisma.jobRequest.count({
      where: {
        category: {
          slug: 'test-history-' + suffix
        }
      }
    });

    assert.equal(remaining, 0);
    console.log('CORRECTO - Transacción revertida');
  } finally {
    await prisma.$disconnect();
  }
});
