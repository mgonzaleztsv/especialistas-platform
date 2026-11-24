import Stripe = require('stripe');

import {
  buildStripeAccountCreationIdentity,
} from './stripe-account-creation-identity';

export function buildStripeAccountCreationParams(
  requestId: string,
  country: string,
  idempotencyKey: string,
): {
  params: Stripe.AccountCreateParams;
  options: Stripe.RequestOptions;
} {
  if (process.env.STRIPE_MODE !== 'test') {
    throw new Error(
      'Creacion Stripe disponible solo en pruebas',
    );
  }

  if (
    typeof country !== 'string' ||
    !/^[A-Z]{2}$/.test(country)
  ) {
    throw new Error('Codigo de pais invalido');
  }

  const metadata =
    buildStripeAccountCreationIdentity(requestId);

  if (
    typeof idempotencyKey !== 'string' ||
    idempotencyKey !== metadata.connectpro_reference
  ) {
    throw new Error('Clave de idempotencia incompatible');
  }

  // Perfil provisional para pruebas.
  // No constituye una decision comercial definitiva.

  return {
    params: {
      country,
      metadata,
      controller: {
        fees: {
          payer: 'application',
        },
        losses: {
          payments: 'application',
        },
        requirement_collection: 'stripe',
        stripe_dashboard: {
          type: 'express',
        },
      },
    },
    options: {
      idempotencyKey,
      maxNetworkRetries: 0,
      timeout: 20000,
    },
  };
}
