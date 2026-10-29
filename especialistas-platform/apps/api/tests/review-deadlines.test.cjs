
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  JobRequestsController
} = require('../dist/job-requests/job-requests.controller.js');

function createController(hours) {
  let status = 'IN_PROGRESS';
  let completedData = null;

  const prisma = {
    specialist: {
      findUnique: async () => ({ id: 'specialist-test' })
    },
    jobRequest: {
      findFirst: async ({ where }) => {
        if (
          status !== 'IN_PROGRESS' ||
          where.id !== 'job-test'
        ) return null;

        return {
          id: 'job-test',
          status,
          reviewPeriodHours: hours
        };
      },
      updateMany: async ({ where, data }) => {
        if (status !== where.status) return { count: 0 };
        completedData = data;
        status = data.status;
        return { count: 1 };
      },
      findUnique: async () => ({
        id: 'job-test',
        status,
        reviewPeriodHours: hours,
        workCompletedAt: completedData?.workCompletedAt,
        reviewDeadline: completedData?.reviewDeadline
      })
    }
  };

  const controller = Object.create(
    JobRequestsController.prototype
  );
  controller.prisma = prisma;

  return { controller, getData: () => completedData };
}

for (const hours of [48, 168]) {
  test(`768 - Plazo de revisión de ${hours} horas`, async () => {
    const { controller, getData } = createController(hours);

    const result = await controller.completeSpecialistJob(
      { user: { userId: 'specialist-user' } },
      'job-test'
    );

    const data = getData();

    assert.equal(result.status, 'AWAITING_CLIENT_CONFIRMATION');
    assert.ok(data.workCompletedAt instanceof Date);
    assert.ok(data.reviewDeadline instanceof Date);

    const difference =
      data.reviewDeadline.getTime() -
      data.workCompletedAt.getTime();

    assert.equal(difference, hours * 60 * 60 * 1000);

    await assert.rejects(
      () => controller.completeSpecialistJob(
        { user: { userId: 'specialist-user' } },
        'job-test'
      )
    );

    assert.equal(getData(), data);

    console.log(
      `CORRECTO - ${hours} horas y repetición rechazada`
    );
  });
}

test('768 - Rechaza plazo inexistente', async () => {
  const { controller, getData } = createController(null);

  await assert.rejects(
    () => controller.completeSpecialistJob(
      { user: { userId: 'specialist-user' } },
      'job-test'
    )
  );

  assert.equal(getData(), null);

  console.log('CORRECTO - Sin plazo no finaliza el trabajo');
});
