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

@Controller('payments/stripe')
export class StripeWebhookController {
  constructor(
    private readonly verifier: StripeWebhookVerifierService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  receive(
    @Req() request: { rawBody?: Buffer },
    @Headers('stripe-signature') signature?: string,
  ): { received: boolean } {
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

    try {
      this.verifier.verify(request.rawBody, signature);
    } catch {
      throw new BadRequestException(
        'No se pudo verificar la firma Stripe',
      );
    }

    // No modificar estados financieros ni ejecutar transferencias.
    return { received: true };
  }
}
