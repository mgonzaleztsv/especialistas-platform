import { PrismaService } from '../prisma/prisma.service';
import {
  evaluateJobNotificationEligibility
} from '../common/job-notification-eligibility';

export interface EligibleSpecialist {
  userId: string;
  specialistId: string;
  distanceMiles: number;
}

export async function findEligibleSpecialists(
  prisma: PrismaService,
  job: {
    categoryId: string;
    latitude: number | null;
    longitude: number | null;
  }
): Promise<EligibleSpecialist[]> {
  if (
    job.latitude === null ||
    job.longitude === null
  ) {
    return [];
  }

  const specialists = await prisma.specialist.findMany({
    where: {
      user: {
        is: {
          status: 'ACTIVE',
          role: 'SPECIALIST'
        }
      },
      availabilityStatus: 'AVAILABLE',
      verificationStatus: 'VERIFIED',
      categories: {
        some: {
          categoryId: job.categoryId
        }
      },
      serviceAreas: {
        some: {
          isActive: true
        }
      }
    },
    select: {
      id: true,
      userId: true,
      categories: {
        select: {
          categoryId: true
        }
      },
      serviceAreas: {
        select: {
          centerLatitude: true,
          centerLongitude: true,
          radiusMiles: true,
          isActive: true
        }
      }
    }
  });

  const eligible: EligibleSpecialist[] = [];

  for (const specialist of specialists) {
    const evaluation = evaluateJobNotificationEligibility(
      job,
      {
        categoryIds: specialist.categories.map(
          category => category.categoryId
        ),
        serviceAreas: specialist.serviceAreas.map(
          area => ({
            centerLatitude: Number(area.centerLatitude),
            centerLongitude: Number(area.centerLongitude),
            radiusMiles: area.radiusMiles,
            isActive: area.isActive
          })
        )
      }
    );

    if (
      evaluation.eligible &&
      evaluation.distanceMiles !== null
    ) {
      eligible.push({
        userId: specialist.userId,
        specialistId: specialist.id,
        distanceMiles: evaluation.distanceMiles
      });
    }
  }

  return eligible.sort(
    (a, b) => a.distanceMiles - b.distanceMiles
  );
}
