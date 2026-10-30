import { Injectable } from '@nestjs/common';
import Stripe = require('stripe');

@Injectable()
export class StripeWebhookVerifierService {
  private readonly verifier = new Stripe(
    'sk_test_local_verification_only'
  );

  verify(payload: Buffer, signature: string): Stripe.Event {
    if (process.env.STRIPE_MODE !== 'test') {
      throw new Error('Webhooks Stripe desactivados');
    }

    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!secret || !secret.startsWith('whsec_')) {
      throw new Error('Secreto webhook de pruebas no configurado');
    }

    if (!Buffer.isBuffer(payload)) {
      throw new Error('El webhook requiere el contenido original');
    }

    if (!signature || typeof signature !== 'string') {
      throw new Error('Firma Stripe ausente');
    }

    return this.verifier.webhooks.constructEvent(
      payload,
      signature,
      secret
    );
  }
}
