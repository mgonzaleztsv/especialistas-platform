import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { StripeWebhookVerifierService } from './stripe-webhook-verifier.service';
import { StripeEventRegistryService } from './stripe-event-registry.service';

@Controller('payments/stripe')
export class StripeWebhookController {
  constructor(
    private readonly verifier: StripeWebhookVerifierService,
    private readonly registry: StripeEventRegistryService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async receive(
    @Req() request: { rawBody?: Buffer },
    @Headers('stripe-signature') signature?: string,
  ): Promise<{ received: boolean }> {
    if (process.env.STRIPE_MODE !== 'test') {
      throw new ServiceUnavailableException(
        'Webhook Stripe desactivado',
      );
    }

    if (!Buffer.isBuffer(request?.rawBody)) {
      throw new BadRequestException(
        'Se requiere el contenido original del webhook',
      );
    }

    if (!signature || typeof signature !== 'string') {
      throw new BadRequestException(
        'Firma Stripe ausente',
      );
    }

    let event;

    try {
      event = this.verifier.verify(request.rawBody, signature);
    } catch {
      throw new BadRequestException(
        'No se pudo verificar la firma Stripe',
      );
    }

    // Registrar solamente eventos autenticados.
    // Un evento duplicado no se vuelve a registrar.
    try {
      await this.registry.recordVerifiedEvent(event);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      // No confirmar recepción si PostgreSQL falló:
      // el proveedor podrá reintentar la entrega.
      throw new ServiceUnavailableException(
        'No se pudo registrar el evento Stripe',
      );
    }

    // Nunca modificar pagos ni realizar transferencias aquí.
    return { received: true };
  }
}
