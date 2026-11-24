import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  buildStripeAccountCreationIdentity,
  matchesStripeAccountCreationIdentity,
} from './stripe-account-creation-identity';

import {
  StripeTestClientService,
} from './stripe-test-client.service';

@Injectable()
export class StripeAccountCreationEvidenceService {
  constructor(
    private readonly stripeClient: StripeTestClientService,
  ) {}

  private assertTestMode(): void {
    if (process.env.STRIPE_MODE !== 'test') {
      throw new ServiceUnavailableException(
        'Conciliacion disponible solo en pruebas',
      );
    }
  }

  async inspectCandidate(
    requestId: string,
    stripeAccountId: string,
    expectedCountry: string,
  ) {
    this.assertTestMode();

    try {
      buildStripeAccountCreationIdentity(requestId);
    } catch {
      throw new BadRequestException(
        'Identificador de solicitud invalido',
      );
    }

    if (
      typeof stripeAccountId !== 'string' ||
      stripeAccountId.length > 255 ||
      !/^acct_[A-Za-z0-9]+$/.test(stripeAccountId)
    ) {
      throw new BadRequestException(
        'Identificador de cuenta Stripe invalido',
      );
    }

    if (
      typeof expectedCountry !== 'string' ||
      !/^[A-Z]{2}$/.test(expectedCountry)
    ) {
      throw new BadRequestException(
        'Codigo de pais invalido',
      );
    }

    this.assertTestMode();

    const observationStartedAt = new Date();

    const client = this.stripeClient.getClient();

    let account;

    try {
      account = await client.accounts.retrieve(
        stripeAccountId,
      );
    } catch {
      throw new BadGatewayException(
        'No fue posible consultar la evidencia Stripe',
      );
    }

    this.assertTestMode();

    if (
      !account ||
      account.object !== 'account' ||
      account.id !== stripeAccountId
    ) {
      throw new BadGatewayException(
        'Cuenta externa incompatible',
      );
    }

    const deleted: unknown =
      Reflect.get(account, 'deleted');

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
        'Cuenta fuera del entorno de pruebas',
      );
    }

    if (
      typeof account.country !== 'string' ||
      !/^[A-Z]{2}$/.test(account.country)
    ) {
      throw new BadGatewayException(
        'Pais externo invalido',
      );
    }

    const countryMatches =
      account.country === expectedCountry;

    const metadataMatches =
      matchesStripeAccountCreationIdentity(
        requestId,
        Reflect.get(account, 'metadata'),
      );

    this.assertTestMode();

    return {
      requestId,
      stripeAccountId: account.id,
      country: account.country,
      livemode: false as const,
      countryMatches,
      metadataMatches,
      observationStartedAt,
      evidenceType: 'ACCOUNT_METADATA' as const,
      candidateMatches:
        countryMatches && metadataMatches,
      linkingAuthorized: false as const,
    };
  }
}
