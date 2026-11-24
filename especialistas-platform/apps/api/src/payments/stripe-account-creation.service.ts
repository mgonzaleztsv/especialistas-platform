import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  StripeTestClientService,
} from './stripe-test-client.service';

import {
  StripeAccountCreationRequestService,
} from './stripe-account-creation-request.service';

import {
  buildStripeAccountCreationParams,
} from './stripe-account-creation-params';

import {
  classifyStripeAccountCreationError,
} from './stripe-account-creation-error';

import {
  validateStripeAccountCreationResponse,
} from './stripe-account-creation-response';

@Injectable()
export class StripeAccountCreationService {
  constructor(
    private readonly requests:
      StripeAccountCreationRequestService,
    private readonly stripe:
      StripeTestClientService,
  ) {}

  private assertTestMode(): void {
    if (process.env.STRIPE_MODE !== 'test') {
      throw new ServiceUnavailableException(
        'Creacion externa disponible solo en pruebas',
      );
    }
  }

  private validProcessingToken(
    token: unknown,
  ): boolean {
    return (
      typeof token === 'string' &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        token,
      )
    );
  }

  private validProcessingDate(
    value: unknown,
  ): boolean {
    if (!(value instanceof Date)) {
      return false;
    }

    const timestamp = value.getTime();
    const now = Date.now();

    return (
      Number.isFinite(timestamp) &&
      timestamp > 0 &&
      timestamp <= now &&
      now - timestamp <= 60000
    );
  }

  private uncertain() {
    return {
      status: 'UNCERTAIN' as const,
      retryAuthorized: false as const,
    };
  }

  private async persistUncertain(
    requestId: string,
    processingToken: string,
    errorCode: string,
  ) {
    try {
      this.assertTestMode();

      const result =
        await this.requests.markUncertain(
          requestId,
          processingToken,
          errorCode,
        );

      this.assertTestMode();

      if (
        result.transitioned !== true ||
        result.requestId !== requestId ||
        result.status !== 'UNCERTAIN' ||
        result.lastErrorCode !== errorCode
      ) {
        throw new Error(
          'Transicion incierta no confirmada',
        );
      }

    } catch {
      // No repetir la operacion externa.
      // El estado persistente puede requerir recuperacion.
      throw new ServiceUnavailableException(
        'Resultado incierto pendiente de recuperacion local',
      );
    }

    return this.uncertain();
  }

  async processRegisteredRequest(
    specialistId: string,
  ) {
    this.assertTestMode();

    // Verificar disponibilidad antes de adquirir
    // el procesamiento persistente.
    try {
      this.stripe.getClient();
    } catch {
      throw new ServiceUnavailableException(
        'Cliente Stripe no disponible',
      );
    }

    const acquired = await (async () => {
      try {
        return await this.requests.acquireProcessing(
          specialistId,
        );
      } catch {
        throw new ServiceUnavailableException(
          'Procesamiento local no disponible',
        );
      }
    })();

    this.assertTestMode();

    const {
      requestId,
      processingToken,
      country,
      idempotencyKey,
    } = acquired;

    if (
      !this.validProcessingToken(processingToken)
    ) {
      throw new ServiceUnavailableException(
        'Identidad de procesamiento incompatible',
      );
    }

    let creation: ReturnType<
      typeof buildStripeAccountCreationParams
    >;

    let client: ReturnType<
      StripeTestClientService['getClient']
    >;

    try {
      if (
        acquired.acquired !== true ||
        acquired.specialistId !== specialistId ||
        acquired.attemptCount !== 1 ||
        !this.validProcessingDate(
          acquired.processingAt,
        )
      ) {
        throw new Error(
          'Procesamiento local incompatible',
        );
      }

      creation = buildStripeAccountCreationParams(
        requestId,
        country,
        idempotencyKey,
      );

      client = this.stripe.getClient();

      this.assertTestMode();

    } catch {
      // Todavia no se ha enviado una solicitud externa.
      this.assertTestMode();

      try {
        const result =
          await this.requests.markFailed(
            requestId,
            processingToken,
            'LOCAL_PRECONDITION_FAILED',
          );

        this.assertTestMode();

        if (
          result.transitioned !== true ||
          result.requestId !== requestId ||
          result.status !== 'FAILED' ||
          result.lastErrorCode !==
            'LOCAL_PRECONDITION_FAILED'
        ) {
          throw new Error(
            'Transicion local no confirmada',
          );
        }
      } catch {
        throw new ServiceUnavailableException(
          'Resultado local pendiente de recuperacion',
        );
      }

      return {
        status: 'FAILED' as const,
        retryAuthorized: false as const,
      };
    }

    let response: unknown;

    try {
      this.assertTestMode();

      // Unico punto de creacion externa.
      response = await client.accounts.create(
        creation.params,
        creation.options,
      );

    } catch (error) {
      this.assertTestMode();

      const classification =
        classifyStripeAccountCreationError(error);

      return this.persistUncertain(
        requestId,
        processingToken,
        classification.errorCode,
      );
    }

    this.assertTestMode();

    const validated =
      validateStripeAccountCreationResponse(
        requestId,
        country,
        response,
      );

    if (!validated) {
      return this.persistUncertain(
        requestId,
        processingToken,
        'EXTERNAL_RESPONSE_INVALID',
      );
    }

    try {
      this.assertTestMode();

      const result =
        await this.requests.markSucceeded(
          requestId,
          processingToken,
          validated,
        );

      this.assertTestMode();

      if (
        result.transitioned !== true ||
        result.status !== 'SUCCEEDED' ||
        result.requestId !== requestId ||
        result.specialistId !== specialistId ||
        result.stripeAccountId !==
          validated.stripeAccountId
      ) {
        throw new Error(
          'Resultado persistente incompatible',
        );
      }

      return {
        status: 'SUCCEEDED' as const,
        requestId,
        stripeAccountId: result.stripeAccountId,
        retryAuthorized: false as const,
      };

    } catch {
      return this.persistUncertain(
        requestId,
        processingToken,
        'LOCAL_PERSISTENCE_ERROR',
      );
    }
  }
}
