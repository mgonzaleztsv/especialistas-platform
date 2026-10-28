import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type OutboxDatabase =
  PrismaService | Prisma.TransactionClient;

export const NEW_JOB_NOTIFICATION_EVENT = 'NEW_JOB';

export async function registerNewJobNotificationEvent(
  prisma: OutboxDatabase,
  jobRequestId: string
): Promise<void> {
  if (
    typeof jobRequestId !== 'string' ||
    jobRequestId.trim().length === 0
  ) {
    throw new Error(
      'El identificador del trabajo es obligatorio'
    );
  }

  await prisma.notificationOutbox.upsert({
    where: {
      jobRequestId_eventType: {
        jobRequestId,
        eventType: NEW_JOB_NOTIFICATION_EVENT
      }
    },
    create: {
      jobRequestId,
      eventType: NEW_JOB_NOTIFICATION_EVENT,
      status: 'PENDING'
    },
    update: {}
  });
}
