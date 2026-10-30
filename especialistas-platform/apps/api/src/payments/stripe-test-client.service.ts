import { Injectable } from '@nestjs/common';
import Stripe = require('stripe');

@Injectable()
export class StripeTestClientService {
  private client: Stripe | null = null;

  isEnabled(): boolean {
    return process.env.STRIPE_MODE === 'test';
  }

  getClient(): Stripe {
    if (!this.isEnabled()) {
      throw new Error(
        'Stripe está desactivado. Solo se permite STRIPE_MODE=test.'
      );
    }

    const secretKey = process.env.STRIPE_SECRET_KEY;

    if (!secretKey || !secretKey.startsWith('sk_test_')) {
      throw new Error(
        'Stripe requiere una clave secreta válida de pruebas.'
      );
    }

    if (!this.client) {
      this.client = new Stripe(secretKey);
    }

    return this.client;
  }
}
