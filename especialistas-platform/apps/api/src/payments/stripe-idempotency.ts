import { createHash } from 'node:crypto';

export type StripeOperation =
  | 'connected-account-create';

export function buildStripeIdempotencyKey(
  operation: StripeOperation,
  operationId: string,
): string {
  if (process.env.STRIPE_MODE !== 'test') {
    throw new Error(
      'Idempotencia Stripe disponible solo en modo de pruebas',
    );
  }

  if (operation !== 'connected-account-create') {
    throw new Error(
      'Operación Stripe no autorizada',
    );
  }

  if (
    typeof operationId !== 'string' ||
    operationId.length === 0 ||
    operationId.length > 255 ||
    operationId.trim() !== operationId ||
    !/^[A-Za-z0-9_-]+$/.test(operationId)
  ) {
    throw new Error(
      'Identificador de operación inválido',
    );
  }

  const canonical = JSON.stringify([
    'connectpro',
    'test',
    'v1',
    operation,
    operationId,
  ]);

  const digest = createHash('sha256')
    .update(canonical, 'utf8')
    .digest('hex');

  return `connectpro:test:v1:${operation}:${digest}`;
}
