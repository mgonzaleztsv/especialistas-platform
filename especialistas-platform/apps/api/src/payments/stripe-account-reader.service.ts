import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { StripeTestClientService } from './stripe-test-client.service';

@Injectable()
export class StripeAccountReaderService {
  constructor(
    private readonly stripeClient: StripeTestClientService,
  ) {}

  async retrieveAccountSnapshot(stripeAccountId: string) {
    if (process.env.STRIPE_MODE !== 'test') {
      throw new ServiceUnavailableException(
        'Consulta Stripe disponible solo en modo de pruebas',
      );
    }

    if (
      typeof stripeAccountId !== 'string' ||
      stripeAccountId.length > 255 ||
      !/^acct_[A-Za-z0-9]+$/.test(stripeAccountId)
    ) {
      throw new BadRequestException(
        'Identificador de cuenta Stripe inválido',
      );
    }

    const client = this.stripeClient.getClient();
    const observationStartedAt = new Date();

    let account;

    try {
      account = await client.accounts.retrieve(stripeAccountId);
    } catch {
      throw new BadGatewayException(
        'No fue posible consultar la cuenta Stripe',
      );
    }

    if (
      !account ||
      account.id !== stripeAccountId ||
      account.object !== 'account'
    ) {
      throw new BadGatewayException(
        'Respuesta de cuenta Stripe incompatible',
      );
    }

    const deleted: unknown = Reflect.get(account, 'deleted');

    if (deleted === true) {
      throw new BadGatewayException(
        'La cuenta Stripe ha sido eliminada',
      );
    }

    if (
      'livemode' in account &&
      account.livemode !== false
    ) {
      throw new BadGatewayException(
        'Cuenta Stripe fuera del entorno de pruebas',
      );
    }

    if (
      typeof account.country !== 'string' ||
      !/^[A-Z]{2}$/.test(account.country)
    ) {
      throw new BadGatewayException(
        'País de cuenta Stripe inválido',
      );
    }

    if (
      typeof account.details_submitted !== 'boolean' ||
      typeof account.charges_enabled !== 'boolean' ||
      typeof account.payouts_enabled !== 'boolean'
    ) {
      throw new BadGatewayException(
        'Estado financiero de Stripe incompleto',
      );
    }

    const transfersCapability =
      account.capabilities?.transfers ?? null;

    if (
      transfersCapability !== null &&
      !['active', 'inactive', 'pending'].includes(
        transfersCapability,
      )
    ) {
      throw new BadGatewayException(
        'Capacidad de transferencias desconocida',
      );
    }

    return {
      stripeAccountId: account.id,
      country: account.country,
      livemode: false,
      detailsSubmitted: account.details_submitted,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      transfersCapability,
      lastSyncedAt: observationStartedAt,
    };
  }
}
