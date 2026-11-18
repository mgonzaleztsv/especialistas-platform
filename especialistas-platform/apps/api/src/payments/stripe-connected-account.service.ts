import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StripeConnectedAccountService {
  constructor(private readonly prisma: PrismaService) {}

  private assertTestMode(): void {
    if (process.env.STRIPE_MODE !== 'test') {
      throw new ServiceUnavailableException(
        'Stripe Connect solo está disponible en modo de pruebas',
      );
    }
  }

  private validateSpecialistId(specialistId: string): void {
    if (
      typeof specialistId !== 'string' ||
      specialistId.length === 0 ||
      specialistId.length > 255 ||
      specialistId.trim() !== specialistId
    ) {
      throw new BadRequestException(
        'Identificador de especialista inválido',
      );
    }
  }

  async findBySpecialistId(specialistId: string) {
    this.assertTestMode();
    this.validateSpecialistId(specialistId);

    return this.prisma.stripeConnectedAccount.findUnique({
      where: { specialistId },
      select: {
        id: true,
        specialistId: true,
        stripeAccountId: true,
        country: true,
        livemode: true,
        detailsSubmitted: true,
        chargesEnabled: true,
        payoutsEnabled: true,
        transfersCapability: true,
        lastSyncedAt: true,
      },
    });
  }

  async getTransferReadiness(specialistId: string) {
    const account = await this.findBySpecialistId(specialistId);

    const reasons: string[] = [];

    if (!account) {
      return {
        eligible: false,
        reasons: ['ACCOUNT_NOT_FOUND'],
      };
    }

    if (account.livemode !== false) {
      reasons.push('LIVE_ACCOUNT_NOT_ALLOWED');
    }

    if (!account.detailsSubmitted) {
      reasons.push('DETAILS_NOT_SUBMITTED');
    }

    if (account.transfersCapability !== 'active') {
      reasons.push('TRANSFERS_NOT_ACTIVE');
    }

    if (!account.payoutsEnabled) {
      reasons.push('PAYOUTS_NOT_ENABLED');
    }

    const syncedAt = account.lastSyncedAt?.getTime();
    const now = Date.now();
    const maxAgeMs = 15 * 60 * 1000;

    if (
      syncedAt === undefined ||
      !Number.isFinite(syncedAt) ||
      syncedAt > now ||
      now - syncedAt > maxAgeMs
    ) {
      reasons.push('ACCOUNT_SYNC_REQUIRED');
    }

    return {
      eligible: reasons.length === 0,
      reasons,
    };
  }
}
