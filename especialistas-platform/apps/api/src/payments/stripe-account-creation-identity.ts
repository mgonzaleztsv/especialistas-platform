import {
  buildStripeIdempotencyKey,
} from './stripe-idempotency';

export function buildStripeAccountCreationIdentity(
  requestId: string,
): Record<string, string> {
  if (process.env.STRIPE_MODE !== 'test') {
    throw new Error(
      'Identidad Stripe disponible solo en pruebas',
    );
  }

  if (
    typeof requestId !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      requestId,
    )
  ) {
    throw new Error(
      'Identificador de solicitud invalido',
    );
  }

  return {
    connectpro_schema: 'v1',
    connectpro_environment: 'test',
    connectpro_operation: 'connected-account-create',
    connectpro_request: requestId,
    connectpro_reference:
      buildStripeIdempotencyKey(
        'connected-account-create',
        requestId,
      ),
  };
}

export function matchesStripeAccountCreationIdentity(
  requestId: string,
  metadata: unknown,
): boolean {
  const expected =
    buildStripeAccountCreationIdentity(requestId);

  if (
    !metadata ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata)
  ) {
    return false;
  }

  return Object.entries(expected).every(
    ([key, value]) => {
      const descriptor =
        Object.getOwnPropertyDescriptor(
          metadata,
          key,
        );

      return (
        descriptor !== undefined &&
        'value' in descriptor &&
        typeof descriptor.value === 'string' &&
        descriptor.value === value
      );
    },
  );
}
