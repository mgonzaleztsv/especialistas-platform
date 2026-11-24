export type StripeCreationErrorCode =
  | 'EXTERNAL_TIMEOUT'
  | 'EXTERNAL_CONNECTION_ERROR'
  | 'EXTERNAL_RESULT_UNKNOWN';

export interface StripeCreationErrorClassification {
  status: 'UNCERTAIN';
  errorCode: StripeCreationErrorCode;
  retryAuthorized: false;
  linkingAuthorized: false;
}

function readOwnString(
  value: unknown,
  key: string,
): string | undefined {
  if (
    typeof value !== 'object' ||
    value === null
  ) {
    return undefined;
  }

  try {
    const descriptor =
      Object.getOwnPropertyDescriptor(value, key);

    if (
      descriptor &&
      'value' in descriptor &&
      typeof descriptor.value === 'string'
    ) {
      return descriptor.value;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function classifyStripeAccountCreationError(
  error: unknown,
): StripeCreationErrorClassification {
  if (process.env.STRIPE_MODE !== 'test') {
    throw new Error(
      'Clasificacion Stripe disponible solo en pruebas',
    );
  }

  const type = readOwnString(error, 'type');
  const code = readOwnString(error, 'code');

  let errorCode: StripeCreationErrorCode =
    'EXTERNAL_RESULT_UNKNOWN';

  const timeoutCodes = [
    'ETIMEDOUT',
    'ESOCKETTIMEDOUT',
    'ECONNABORTED',
  ];

  const connectionCodes = [
    'ECONNRESET',
    'ECONNREFUSED',
    'EPIPE',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ENETUNREACH',
    'EHOSTUNREACH',
  ];

  if (
    code !== undefined &&
    timeoutCodes.includes(code)
  ) {
    errorCode = 'EXTERNAL_TIMEOUT';

  } else if (
    type === 'StripeConnectionError' ||
    (
      code !== undefined &&
      connectionCodes.includes(code)
    )
  ) {
    errorCode = 'EXTERNAL_CONNECTION_ERROR';
  }

  // Una clasificacion diagnostica no demuestra
  // que Stripe haya rechazado la operacion.
  // Nunca autorizar reintentos ni vinculaciones.

  return {
    status: 'UNCERTAIN',
    errorCode,
    retryAuthorized: false,
    linkingAuthorized: false,
  };
}
