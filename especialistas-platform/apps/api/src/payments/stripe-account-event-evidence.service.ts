import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  StripeTestClientService,
} from './stripe-test-client.service';

import {
  buildStripeAccountCreationIdentity,
  matchesStripeAccountCreationIdentity,
} from './stripe-account-creation-identity';

@Injectable()
export class StripeAccountEventEvidenceService {
  constructor(
    private readonly stripeClient: StripeTestClientService,
  ) {}

  private assertTestMode(): void {
    if (process.env.STRIPE_MODE !== 'test') {
      throw new ServiceUnavailableException(
        'Evidencia historica disponible solo en pruebas',
      );
    }
  }

  async inspectEvent(
    requestId: string,
    stripeAccountId: string,
    stripeEventId: string,
    expectedCountry: string,
  ) {
    this.assertTestMode();

    let identity: Record<string, string>;

    try {
      identity =
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
        'Identificador de cuenta invalido',
      );
    }

    if (
      typeof stripeEventId !== 'string' ||
      stripeEventId.length > 255 ||
      !/^evt_[A-Za-z0-9_]+$/.test(stripeEventId)
    ) {
      throw new BadRequestException(
        'Identificador de evento invalido',
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

    let event;

    try {
      event = await client.events.retrieve(
        stripeEventId,
      );
    } catch {
      throw new BadGatewayException(
        'No fue posible consultar el evento Stripe',
      );
    }

    this.assertTestMode();

    if (
      !event ||
      event.object !== 'event' ||
      event.id !== stripeEventId ||
      event.livemode !== false
    ) {
      throw new BadGatewayException(
        'Evento externo incompatible',
      );
    }

    if (
      !Number.isSafeInteger(event.created) ||
      event.created <= 0 ||
      event.created >
        Math.floor(Date.now() / 1000)
    ) {
      throw new BadGatewayException(
        'Fecha de evento invalida',
      );
    }

    const eventCreatedAt =
      new Date(event.created * 1000);

    const snapshot: unknown = event.data?.object;

    let accountMatches = false;
    let countryMatches = false;
    let metadataMatches = false;

    if (
      snapshot &&
      typeof snapshot === 'object'
    ) {
      const data =
        snapshot as Record<string, unknown>;

      accountMatches =
        data.object === 'account' &&
        data.id === stripeAccountId &&
        data.deleted !== true &&
        (
          !('livemode' in data) ||
          data.livemode === false
        );

      countryMatches =
        data.country === expectedCountry;

      metadataMatches =
        matchesStripeAccountCreationIdentity(
          requestId,
          data.metadata,
        );
    }

    const eventTypeMatches =
      event.type === 'account.updated';

    const eventContextMatches =
      event.account === stripeAccountId;

    const apiRequestId = event.request?.id;

    const apiRequestPresent =
      typeof apiRequestId === 'string' &&
      apiRequestId.length <= 255 &&
      /^req_[A-Za-z0-9]+$/.test(apiRequestId);

    const idempotencyMatches =
      event.request?.idempotency_key ===
        identity.connectpro_reference;

    this.assertTestMode();

    return {
      requestId,
      stripeAccountId,
      stripeEventId,
      livemode: false as const,
      eventCreatedAt,
      observationStartedAt,
      eventTypeMatches,
      eventContextMatches,
      accountMatches,
      countryMatches,
      metadataMatches,
      apiRequestPresent,
      idempotencyMatches,
      evidenceType: 'STRIPE_EVENT' as const,
      historicalEvidenceMatches:
        eventTypeMatches &&
        eventContextMatches &&
        accountMatches &&
        countryMatches &&
        metadataMatches &&
        apiRequestPresent &&
        idempotencyMatches,
      linkingAuthorized: false as const,
    };
  }
}
