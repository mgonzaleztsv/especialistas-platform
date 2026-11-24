import {
  buildStripeAccountCreationIdentity,
  matchesStripeAccountCreationIdentity,
} from './stripe-account-creation-identity';

export interface ValidatedStripeCreationResponse {
  stripeAccountId: string;
  country: string;
  livemode: false;
}

function readOwnValue(
  object: object,
  key: string,
): unknown {
  const descriptor =
    Object.getOwnPropertyDescriptor(object, key);

  if (!descriptor) {
    return undefined;
  }

  if (!('value' in descriptor)) {
    throw new Error('Propiedad externa incompatible');
  }

  return descriptor.value;
}

export function validateStripeAccountCreationResponse(
  requestId: string,
  expectedCountry: string,
  response: unknown,
): ValidatedStripeCreationResponse | null {
  if (process.env.STRIPE_MODE !== 'test') {
    throw new Error(
      'Validacion Stripe disponible solo en pruebas',
    );
  }

  buildStripeAccountCreationIdentity(requestId);

  if (
    typeof expectedCountry !== 'string' ||
    !/^[A-Z]{2}$/.test(expectedCountry)
  ) {
    throw new Error('Pais esperado invalido');
  }

  try {
    if (
      !response ||
      typeof response !== 'object' ||
      Array.isArray(response)
    ) {
      return null;
    }

    const id = readOwnValue(response, 'id');
    const object = readOwnValue(response, 'object');
    const country = readOwnValue(response, 'country');
    const deleted = readOwnValue(response, 'deleted');
    const livemode = readOwnValue(response, 'livemode');
    const metadata = readOwnValue(response, 'metadata');

    const chargesEnabled =
      readOwnValue(response, 'charges_enabled');

    const payoutsEnabled =
      readOwnValue(response, 'payouts_enabled');

    const detailsSubmitted =
      readOwnValue(response, 'details_submitted');

    if (
      typeof id !== 'string' ||
      id.length > 255 ||
      !/^acct_[A-Za-z0-9]+$/.test(id) ||
      object !== 'account' ||
      country !== expectedCountry
    ) {
      return null;
    }

    if (
      deleted !== undefined &&
      deleted !== false
    ) {
      return null;
    }

    if (
      livemode !== undefined &&
      livemode !== false
    ) {
      return null;
    }

    if (
      chargesEnabled !== false ||
      payoutsEnabled !== false ||
      detailsSubmitted !== false
    ) {
      return null;
    }

    if (
      !matchesStripeAccountCreationIdentity(
        requestId,
        metadata,
      )
    ) {
      return null;
    }

    if (process.env.STRIPE_MODE !== 'test') {
      return null;
    }

    // El entorno de prueba debe estar garantizado
    // adicionalmente por el cliente Stripe.
    // Esta funcion no autoriza vinculaciones.

    return {
      stripeAccountId: id,
      country: expectedCountry,
      livemode: false,
    };

  } catch {
    // No divulgar respuestas ni errores externos.
    return null;
  }
}
