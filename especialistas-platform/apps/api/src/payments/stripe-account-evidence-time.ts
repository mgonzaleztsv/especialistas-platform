export function evaluateStripeEvidenceTime(
  input: {
    firstAttemptAt: Date;
    lastAttemptAt: Date;
    eventCreatedAt: Date;
    searchStartedAt: Date;
    searchCompletedAt: Date;
    accountObservedAt: Date;
    eventObservedAt: Date;
  },
  now: Date = new Date(),
) {
  if (process.env.STRIPE_MODE !== 'test') {
    throw new Error(
      'Evaluacion temporal disponible solo en pruebas',
    );
  }

  const invalid = (reason: string) => ({
    temporalEvidenceMatches: false as const,
    reason,
    linkingAuthorized: false as const,
    retryAuthorized: false as const,
  });

  const validDate = (value: unknown): value is Date =>
    value instanceof Date &&
    Number.isFinite(value.getTime()) &&
    value.getTime() > 0;

  if (!input || typeof input !== 'object') {
    return invalid('INVALID_INPUT');
  }

  const dates = [
    input.firstAttemptAt,
    input.lastAttemptAt,
    input.eventCreatedAt,
    input.searchStartedAt,
    input.searchCompletedAt,
    input.accountObservedAt,
    input.eventObservedAt,
    now,
  ];

  if (!dates.every(validDate)) {
    return invalid('INVALID_DATE');
  }

  const current = now.getTime();

  if (dates.some(date => date.getTime() > current)) {
    return invalid('FUTURE_DATE');
  }

  const first = input.firstAttemptAt.getTime();
  const last = input.lastAttemptAt.getTime();
  const event = input.eventCreatedAt.getTime();

  const searchStart = input.searchStartedAt.getTime();
  const searchEnd = input.searchCompletedAt.getTime();

  const accountObservation =
    input.accountObservedAt.getTime();

  const eventObservation =
    input.eventObservedAt.getTime();

  const maximumEventWindowMs = 24 * 60 * 60 * 1000;
  const maximumObservationAgeMs = 5 * 60 * 1000;

  if (first !== last) {
    return invalid('INCOMPATIBLE_ATTEMPT_HISTORY');
  }

  // Stripe expresa la fecha del evento en segundos.
  const firstSecond =
    Math.floor(first / 1000) * 1000;

  if (event % 1000 !== 0) {
    return invalid('INVALID_EVENT_PRECISION');
  }

  if (event < firstSecond) {
    return invalid('EVENT_BEFORE_ATTEMPT');
  }

  if (event >= first + maximumEventWindowMs) {
    return invalid('EVENT_OUTSIDE_WINDOW');
  }

  if (
    searchStart < first ||
    searchEnd < searchStart ||
    accountObservation < searchEnd ||
    eventObservation < accountObservation ||
    eventObservation < event
  ) {
    return invalid('INCOMPATIBLE_OBSERVATION_ORDER');
  }

  const observations = [
    searchStart,
    searchEnd,
    accountObservation,
    eventObservation,
  ];

  if (
    observations.some(
      observation =>
        current - observation >
        maximumObservationAgeMs,
    )
  ) {
    return invalid('STALE_OBSERVATION');
  }

  return {
    temporalEvidenceMatches: true as const,
    reason: 'TEMPORALLY_COMPATIBLE',
    linkingAuthorized: false as const,
    retryAuthorized: false as const,
  };
}
