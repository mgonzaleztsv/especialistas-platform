import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StripeConnectedAccountService } from './stripe-connected-account.service';
import { StripeAccountReaderService } from './stripe-account-reader.service';

@Injectable()
export class StripeAccountSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: StripeConnectedAccountService,
    private readonly reader: StripeAccountReaderService,
  ) {}

  async syncBySpecialistId(specialistId: string) {
    if (process.env.STRIPE_MODE !== 'test') {
      throw new ServiceUnavailableException(
        'Sincronización Stripe disponible solo en modo de pruebas',
      );
    }

    const account =
      await this.accounts.findBySpecialistId(specialistId);

    if (!account) {
      throw new NotFoundException(
        'El especialista no tiene una cuenta Stripe vinculada',
      );
    }

    if (account.livemode !== false) {
      throw new ConflictException(
        'No se permite sincronizar cuentas reales',
      );
    }

    const snapshot =
      await this.reader.retrieveAccountSnapshot(
        account.stripeAccountId,
      );

    if (
      snapshot.stripeAccountId !== account.stripeAccountId ||
      snapshot.country !== account.country ||
      snapshot.livemode !== false
    ) {
      throw new BadGatewayException(
        'La información Stripe no coincide con la cuenta vinculada',
      );
    }

    const observation = snapshot.lastSyncedAt;

    if (
      !(observation instanceof Date) ||
      !Number.isFinite(observation.getTime()) ||
      observation.getTime() > Date.now() ||
      Date.now() - observation.getTime() > 15 * 60 * 1000
    ) {
      throw new BadGatewayException(
        'Fecha de sincronización Stripe inválida o vencida',
      );
    }

    // Volver a comprobar el entorno después de la consulta externa.
    if (process.env.STRIPE_MODE !== 'test') {
      throw new ServiceUnavailableException(
        'Sincronización Stripe desactivada',
      );
    }

    // Actualización condicional y atómica.
    // No modificar la identidad ni la titularidad de la cuenta.
    const updated =
      await this.prisma.stripeConnectedAccount.updateMany({
        where: {
          id: account.id,
          specialistId: account.specialistId,
          stripeAccountId: account.stripeAccountId,
          country: account.country,
          livemode: false,
          OR: [
            { lastSyncedAt: null },
            { lastSyncedAt: { lt: observation } },
          ],
        },
        data: {
          detailsSubmitted: snapshot.detailsSubmitted,
          chargesEnabled: snapshot.chargesEnabled,
          payoutsEnabled: snapshot.payoutsEnabled,
          transfersCapability: snapshot.transfersCapability,
          lastSyncedAt: observation,
        },
      });

    if (updated.count !== 1) {
      throw new ConflictException(
        'La cuenta cambió o existe una sincronización igual o más reciente',
      );
    }

    return {
      synchronized: true,
      specialistId: account.specialistId,
      lastSyncedAt: observation,
    };
  }
}
