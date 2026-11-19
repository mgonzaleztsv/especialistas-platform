import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { buildStripeIdempotencyKey } from './stripe-idempotency';

@Injectable()
export class StripeAccountCreationRequestService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  private assertTestMode(): void {
    if (process.env.STRIPE_MODE !== 'test') {
      throw new ServiceUnavailableException(
        'Alta Stripe disponible solo en modo de pruebas',
      );
    }
  }

  private validateSpecialistId(
    specialistId: string,
  ): void {
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

  private validateCountry(country: string): void {
    if (
      typeof country !== 'string' ||
      !/^[A-Z]{2}$/.test(country)
    ) {
      throw new BadRequestException(
        'Código de país inválido',
      );
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }

  private validateExistingRequest(
    request: {
      country: string;
      livemode: boolean;
    },
    country: string,
  ): void {
    if (request.livemode !== false) {
      throw new ConflictException(
        'No se permite administrar solicitudes reales',
      );
    }

    if (request.country !== country) {
      throw new ConflictException(
        'El país de la solicitud no puede modificarse',
      );
    }
  }

  async registerRequest(
    specialistId: string,
    country: string,
  ) {
    this.assertTestMode();
    this.validateSpecialistId(specialistId);
    this.validateCountry(country);

    const specialist =
      await this.prisma.specialist.findUnique({
        where: { id: specialistId },
        select: { id: true },
      });

    if (!specialist) {
      throw new NotFoundException(
        'Especialista inexistente',
      );
    }

    const existing =
      await this.prisma.stripeAccountCreationRequest.findUnique({
        where: { specialistId },
      });

    if (existing) {
      this.validateExistingRequest(existing, country);

      return {
        created: false,
        request: existing,
      };
    }

    const connected =
      await this.prisma.stripeConnectedAccount.findUnique({
        where: { specialistId },
        select: { id: true },
      });

    if (connected) {
      throw new ConflictException(
        'El especialista ya tiene una cuenta Stripe vinculada',
      );
    }

    this.assertTestMode();

    const id = randomUUID();

    const idempotencyKey =
      buildStripeIdempotencyKey(
        'connected-account-create',
        id,
      );

    try {
      const request =
        await this.prisma.stripeAccountCreationRequest.create({
          data: {
            id,
            specialistId,
            country,
            idempotencyKey,
            livemode: false,
            status: 'PENDING',
          },
        });

      return {
        created: true,
        request,
      };

    } catch (error) {
      if (!this.isUniqueViolation(error)) {
        throw error;
      }

      // Una solicitud concurrente pudo haber ganado
      // la restriccion de unicidad por especialista.
      const concurrent =
        await this.prisma.stripeAccountCreationRequest.findUnique({
          where: { specialistId },
        });

      if (!concurrent) {
        throw error;
      }

      this.validateExistingRequest(
        concurrent,
        country,
      );

      return {
        created: false,
        request: concurrent,
      };
    }
  }

  async acquireProcessing(specialistId: string) {
    this.assertTestMode();
    this.validateSpecialistId(specialistId);

    const request =
      await this.prisma.stripeAccountCreationRequest.findUnique({
        where: { specialistId },
      });

    if (!request) {
      throw new NotFoundException(
        'Solicitud de alta Stripe inexistente',
      );
    }

    if (request.livemode !== false) {
      throw new ConflictException(
        'No se permite procesar solicitudes reales',
      );
    }

    if (
      request.status !== 'PENDING' ||
      request.attemptCount !== 0 ||
      request.stripeAccountId !== null ||
      request.processingToken !== null ||
      request.processingAt !== null ||
      request.firstAttemptAt !== null ||
      request.lastAttemptAt !== null ||
      request.completedAt !== null ||
      request.lastErrorCode !== null
    ) {
      throw new ConflictException(
        'La solicitud no admite un nuevo procesamiento',
      );
    }

    this.validateCountry(request.country);

    this.assertTestMode();

    const expectedKey =
      buildStripeIdempotencyKey(
        'connected-account-create',
        request.id,
      );

    if (request.idempotencyKey !== expectedKey) {
      throw new ConflictException(
        'Clave de idempotencia incompatible',
      );
    }

    const processingToken = randomUUID();

    const now = new Date();

    // Una sola instruccion de actualizacion.
    // La identidad y el estado inicial deben conservarse.
    // Una cuenta previamente vinculada impide la adquisicion.

    const updated =
      await this.prisma.stripeAccountCreationRequest.updateMany({
        where: {
          id: request.id,
          specialistId,
          country: request.country,
          idempotencyKey: expectedKey,
          livemode: false,
          status: 'PENDING',
          attemptCount: 0,
          stripeAccountId: null,
          processingToken: null,
          processingAt: null,
          firstAttemptAt: null,
          lastAttemptAt: null,
          completedAt: null,
          lastErrorCode: null,
          specialist: {
            is: {
              stripeConnectedAccount: {
                is: null,
              },
            },
          },
        },

        data: {
          status: 'PROCESSING',
          processingToken,
          processingAt: now,
          firstAttemptAt: now,
          lastAttemptAt: now,
          attemptCount: {
            increment: 1,
          },
        },
      });

    if (updated.count !== 1) {
      throw new ConflictException(
        'La solicitud cambio o ya esta siendo procesada',
      );
    }

    return {
      acquired: true,
      requestId: request.id,
      specialistId,
      country: request.country,
      idempotencyKey: expectedKey,
      processingToken,
      processingAt: now,
      attemptCount: 1,
    };
  }

  private validateProcessingToken(
    processingToken: string,
  ): void {
    if (
      typeof processingToken !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        processingToken,
      )
    ) {
      throw new BadRequestException(
        'Token de procesamiento inválido',
      );
    }
  }

  private async finishWithoutAccount(
    requestId: string,
    processingToken: string,
    target: 'FAILED' | 'UNCERTAIN',
    errorCode: string,
  ) {
    this.assertTestMode();

    if (
      typeof requestId !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        requestId,
      )
    ) {
      throw new BadRequestException(
        'Identificador de solicitud inválido',
      );
    }

    this.validateProcessingToken(processingToken);

    // Solo codigos internos predefinidos.
    // No almacenar mensajes externos ni datos sensibles.

    const allowedErrors = {
      FAILED: [
        'LOCAL_PRECONDITION_FAILED',
        'EXTERNAL_REJECTION_CONFIRMED',
      ],
      UNCERTAIN: [
        'EXTERNAL_TIMEOUT',
        'EXTERNAL_CONNECTION_ERROR',
        'EXTERNAL_RESULT_UNKNOWN',
        'EXTERNAL_RESPONSE_INVALID',
        'LOCAL_PERSISTENCE_ERROR',
      ],
    };

    if (
      (target !== 'FAILED' &&
       target !== 'UNCERTAIN') ||
      typeof errorCode !== 'string' ||
      !allowedErrors[target].includes(errorCode)
    ) {
      throw new BadRequestException(
        'Resultado de procesamiento inválido',
      );
    }

    const expectedKey =
      buildStripeIdempotencyKey(
        'connected-account-create',
        requestId,
      );

    const now = new Date();

    const updated =
      await this.prisma.stripeAccountCreationRequest.updateMany({
        where: {
          id: requestId,
          idempotencyKey: expectedKey,
          livemode: false,
          status: 'PROCESSING',
          processingToken,
          attemptCount: 1,
          stripeAccountId: null,
          processingAt: { lte: now },
          firstAttemptAt: { lte: now },
          lastAttemptAt: { lte: now },
          completedAt: null,
          lastErrorCode: null,
        },

        data: {
          status: target,
          processingToken: null,
          processingAt: null,
          completedAt:
            target === 'FAILED' ? now : null,
          lastErrorCode: errorCode,
        },
      });

    if (updated.count !== 1) {
      throw new ConflictException(
        'La solicitud no admite esta transición',
      );
    }

    return {
      transitioned: true,
      requestId,
      status: target,
      lastErrorCode: errorCode,
      completedAt:
        target === 'FAILED' ? now : null,
    };
  }

  async markFailed(
    requestId: string,
    processingToken: string,
    errorCode: string,
  ) {
    return this.finishWithoutAccount(
      requestId,
      processingToken,
      'FAILED',
      errorCode,
    );
  }

  async markUncertain(
    requestId: string,
    processingToken: string,
    errorCode: string,
  ) {
    return this.finishWithoutAccount(
      requestId,
      processingToken,
      'UNCERTAIN',
      errorCode,
    );
  }

  async markSucceeded(
    requestId: string,
    processingToken: string,
    externalAccount: {
      stripeAccountId: string;
      country: string;
      livemode: boolean;
    },
  ) {
    this.assertTestMode();

    if (
      typeof requestId !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        requestId,
      )
    ) {
      throw new BadRequestException(
        'Identificador de solicitud inválido',
      );
    }

    this.validateProcessingToken(processingToken);

    if (
      !externalAccount ||
      typeof externalAccount !== 'object' ||
      typeof externalAccount.stripeAccountId !== 'string' ||
      externalAccount.stripeAccountId.length > 255 ||
      !/^acct_[A-Za-z0-9]+$/.test(
        externalAccount.stripeAccountId,
      ) ||
      externalAccount.livemode !== false
    ) {
      throw new BadRequestException(
        'Cuenta externa Stripe incompatible',
      );
    }

    const stripeAccountId =
      externalAccount.stripeAccountId;

    const country = externalAccount.country;

    this.validateCountry(country);

    const expectedKey =
      buildStripeIdempotencyKey(
        'connected-account-create',
        requestId,
      );

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          this.assertTestMode();

          const request =
            await tx.stripeAccountCreationRequest.findUnique({
              where: { id: requestId },
            });

          if (!request) {
            throw new NotFoundException(
              'Solicitud de alta Stripe inexistente',
            );
          }

          if (
            request.livemode !== false ||
            request.country !== country ||
            request.idempotencyKey !== expectedKey ||
            request.status !== 'PROCESSING' ||
            request.processingToken !== processingToken ||
            request.attemptCount !== 1 ||
            request.stripeAccountId !== null
          ) {
            throw new ConflictException(
              'La solicitud no admite esta vinculación',
            );
          }

          const now = new Date();

          this.assertTestMode();

          // Adquirir la transicion dentro de la transaccion.
          // Si la vinculacion falla, esta escritura se revierte.

          const updated =
            await tx.stripeAccountCreationRequest.updateMany({
              where: {
                id: requestId,
                specialistId: request.specialistId,
                country,
                idempotencyKey: expectedKey,
                livemode: false,
                status: 'PROCESSING',
                processingToken,
                attemptCount: 1,
                stripeAccountId: null,
                completedAt: null,
                lastErrorCode: null,
                processingAt: { lte: now },
                firstAttemptAt: { lte: now },
                lastAttemptAt: { lte: now },
                specialist: {
                  is: {
                    stripeConnectedAccount: {
                      is: null,
                    },
                  },
                },
              },

              data: {
                status: 'SUCCEEDED',
                stripeAccountId,
                processingToken: null,
                processingAt: null,
                completedAt: now,
                lastErrorCode: null,
              },
            });

          if (updated.count !== 1) {
            throw new ConflictException(
              'La solicitud cambió durante la vinculación',
            );
          }

          this.assertTestMode();

          // Una cuenta creada no es una cuenta habilitada.
          // Todos los indicadores comienzan desactivados.

          const account =
            await tx.stripeConnectedAccount.create({
              data: {
                specialistId: request.specialistId,
                stripeAccountId,
                country,
                livemode: false,
                detailsSubmitted: false,
                chargesEnabled: false,
                payoutsEnabled: false,
                transfersCapability: null,
                lastSyncedAt: null,
              },
            });

          this.assertTestMode();

          return {
            transitioned: true,
            requestId,
            specialistId: request.specialistId,
            stripeAccountId: account.stripeAccountId,
            status: 'SUCCEEDED' as const,
            completedAt: now,
          };
        },
        {
          isolationLevel: 'Serializable',
        },
      );

    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'La cuenta Stripe ya se encuentra registrada',
        );
      }

      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2034'
      ) {
        throw new ConflictException(
          'Conflicto concurrente durante la vinculación',
        );
      }

      throw error;
    }
  }

  async markAbandonedProcessing(
    requestId: string,
  ) {
    this.assertTestMode();

    if (
      typeof requestId !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        requestId,
      )
    ) {
      throw new BadRequestException(
        'Identificador de solicitud inválido',
      );
    }

    // Plazo conservador provisional.
    // No autoriza reintentos ni nuevas cuentas.

    const minimumAgeMs = 30 * 60 * 1000;

    const now = new Date();

    const cutoff = new Date(
      now.getTime() - minimumAgeMs,
    );

    const expectedKey =
      buildStripeIdempotencyKey(
        'connected-account-create',
        requestId,
      );

    const request =
      await this.prisma.stripeAccountCreationRequest.findUnique({
        where: { id: requestId },
      });

    if (!request) {
      throw new NotFoundException(
        'Solicitud de alta Stripe inexistente',
      );
    }

    if (
      request.livemode !== false ||
      request.status !== 'PROCESSING' ||
      request.attemptCount !== 1 ||
      request.idempotencyKey !== expectedKey ||
      request.stripeAccountId !== null ||
      request.completedAt !== null ||
      request.lastErrorCode !== null ||
      request.processingToken === null ||
      request.processingAt === null ||
      request.firstAttemptAt === null ||
      request.lastAttemptAt === null
    ) {
      throw new ConflictException(
        'La solicitud no admite recuperación',
      );
    }

    const processingToken =
      request.processingToken;

    this.validateProcessingToken(
      processingToken,
    );

    const dates = [
      request.processingAt,
      request.firstAttemptAt,
      request.lastAttemptAt,
    ];

    if (
      dates.some(
        date =>
          !(date instanceof Date) ||
          !Number.isFinite(date.getTime()) ||
          date.getTime() > cutoff.getTime(),
      )
    ) {
      throw new ConflictException(
        'El procesamiento todavía no puede considerarse abandonado',
      );
    }

    if (
      request.processingAt.getTime() !==
        request.firstAttemptAt.getTime() ||
      request.processingAt.getTime() !==
        request.lastAttemptAt.getTime()
    ) {
      throw new ConflictException(
        'Historial de procesamiento incompatible',
      );
    }

    this.assertTestMode();

    // No ejecutar ninguna operacion externa.
    // Invalidar exclusivamente el procesamiento
    // observado, si no ha cambiado desde la lectura.

    const updated =
      await this.prisma.stripeAccountCreationRequest.updateMany({
        where: {
          id: requestId,
          specialistId: request.specialistId,
          country: request.country,
          idempotencyKey: expectedKey,
          livemode: false,
          status: 'PROCESSING',
          processingToken,
          attemptCount: 1,
          stripeAccountId: null,
          completedAt: null,
          lastErrorCode: null,
          processingAt: request.processingAt,
          firstAttemptAt: request.firstAttemptAt,
          lastAttemptAt: request.lastAttemptAt,
          specialist: {
            is: {
              stripeConnectedAccount: {
                is: null,
              },
            },
          },
        },

        data: {
          status: 'UNCERTAIN',
          processingToken: null,
          processingAt: null,
          completedAt: null,
          lastErrorCode: 'LOCAL_PROCESSING_ABANDONED',
        },
      });

    if (updated.count !== 1) {
      throw new ConflictException(
        'La solicitud cambió durante la recuperación',
      );
    }

    return {
      transitioned: true,
      requestId,
      status: 'UNCERTAIN' as const,
      lastErrorCode: 'LOCAL_PROCESSING_ABANDONED',
      completedAt: null,
    };
  }
}
