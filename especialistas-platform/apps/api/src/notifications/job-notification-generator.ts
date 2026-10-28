import { PrismaService } from '../prisma/prisma.service';
import { findEligibleSpecialists } from './job-notification-matcher';

export interface JobNotificationGenerationResult {
  eligible: number;
  created: number;
}

export async function generateNewJobNotifications(
  prisma: PrismaService,
  jobRequestId: string
): Promise<JobNotificationGenerationResult> {
  const job = await prisma.jobRequest.findUnique({
    where: { id: jobRequestId },
    select: {
      id: true,
      title: true,
      categoryId: true,
      status: true,
      city: true,
      state: true,
      latitude: true,
      longitude: true,
      locationVerificationStatus: true
    }
  });

  if (
    !job ||
    !['PUBLISHED', 'RECEIVING_QUOTES'].includes(job.status)
  ) {
    return { eligible: 0, created: 0 };
  }

  if (
    job.latitude === null ||
    job.longitude === null ||
    job.locationVerificationStatus !== 'VERIFIED'
  ) {
    return { eligible: 0, created: 0 };
  }

  const eligible = await findEligibleSpecialists(prisma, {
    categoryId: job.categoryId,
    latitude: Number(job.latitude),
    longitude: Number(job.longitude)
  });

  if (eligible.length === 0) {
    return { eligible: 0, created: 0 };
  }

  const result = await prisma.notification.createMany({
    data: eligible.map(specialist => ({
      userId: specialist.userId,
      jobRequestId: job.id,
      type: 'NEW_JOB',
      title: 'Nueva solicitud de trabajo',
      body: 'Hay un nuevo trabajo en ' +
        job.city + ', ' + job.state +
        ' que coincide con tu especialidad y zona de servicio.'
    })),
    skipDuplicates: true
  });

  return {
    eligible: eligible.length,
    created: result.count
  };
}
