import { PrismaService } from '../prisma/prisma.service';
import { generateNewJobNotifications } from './job-notification-generator';
import { NEW_JOB_NOTIFICATION_EVENT } from './notification-outbox';

export type OutboxProcessResult =
  'PROCESSED' | 'RETRY' | 'FAILED' | 'SKIPPED';

const MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * 60 * 1000;

export async function processNotificationOutboxEvent(
  prisma: PrismaService,
  eventId: string
): Promise<OutboxProcessResult> {
  const now = new Date();

  const event = await prisma.notificationOutbox.findUnique({
    where: { id: eventId }
  });

  if (!event || event.nextAttemptAt > now) {
    return 'SKIPPED';
  }

  const claim = await prisma.notificationOutbox.updateMany({
    where: {
      id: eventId,
      status: {
        in: ['PENDING', 'PROCESSING']
      },
      nextAttemptAt: { lte: now },
      attempts: { lt: MAX_ATTEMPTS }
    },
    data: {
      status: 'PROCESSING',
      attempts: { increment: 1 },
      nextAttemptAt: new Date(now.getTime() + LEASE_MS),
      lastError: null
    }
  });

  if (claim.count !== 1) {
    return 'SKIPPED';
  }

  const attempt = event.attempts + 1;
  const leaseUntil = new Date(now.getTime() + LEASE_MS);

  try {
    if (event.eventType !== NEW_JOB_NOTIFICATION_EVENT) {
      throw new Error('Tipo de evento no reconocido');
    }

    await generateNewJobNotifications(prisma, event.jobRequestId);

    const completed = await prisma.notificationOutbox.updateMany({
      where: {
        id: eventId,
        status: 'PROCESSING',
        attempts: attempt,
        nextAttemptAt: leaseUntil
      },
      data: {
        status: 'COMPLETED',
        processedAt: new Date()
      }
    });

    return completed.count === 1 ? 'PROCESSED' : 'SKIPPED';
  } catch (error) {
    const failed = attempt >= MAX_ATTEMPTS;
    const delayMinutes = Math.min(2 ** attempt, 60);

    const recorded = await prisma.notificationOutbox.updateMany({
      where: {
        id: eventId,
        status: 'PROCESSING',
        attempts: attempt,
        nextAttemptAt: leaseUntil
      },
      data: {
        status: failed ? 'FAILED' : 'PENDING',
        nextAttemptAt: new Date(
          Date.now() + delayMinutes * 60 * 1000
        ),
        lastError: error instanceof Error
          ? error.message.slice(0, 500)
          : 'Error desconocido'
      }
    });

    if (recorded.count !== 1) {
      return 'SKIPPED';
    }

    return failed ? 'FAILED' : 'RETRY';
  }
}
