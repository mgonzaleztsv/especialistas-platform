import {
  buildStripeAccountCreationIdentity,
} from './stripe-account-creation-identity';

import {
  evaluateStripeEvidenceTime,
} from './stripe-account-evidence-time';

import type {
  StripeAccountCandidateSearchService,
} from './stripe-account-candidate-search.service';

import type {
  StripeAccountCreationEvidenceService,
} from './stripe-account-creation-evidence.service';

import type {
  StripeAccountEventEvidenceService,
} from './stripe-account-event-evidence.service';

type SearchEvidence = Awaited<
  ReturnType<
    StripeAccountCandidateSearchService['searchCandidates']
  >
>;

type AccountEvidence = Awaited<
  ReturnType<
    StripeAccountCreationEvidenceService['inspectCandidate']
  >
>;

type HistoricalEvidence = Awaited<
  ReturnType<
    StripeAccountEventEvidenceService['inspectEvent']
  >
>;

type LocalRequest = {
  id: string;
  specialistId: string;
  country: string;
  idempotencyKey: string;
  livemode: boolean;
  status: string;
  attemptCount: number;
  stripeAccountId: string | null;
  processingToken: string | null;
  processingAt: Date | null;
  firstAttemptAt: Date | null;
  lastAttemptAt: Date | null;
  completedAt: Date | null;
  lastErrorCode: string | null;
};

export function evaluateStripeReconciliation(
  request: LocalRequest,
  search: SearchEvidence,
  account: AccountEvidence,
  historical: HistoricalEvidence,
  now: Date = new Date(),
) {
  if (process.env.STRIPE_MODE !== 'test') {
    throw new Error(
      'Conciliacion disponible solo en pruebas',
    );
  }

  const reject = (reason: string) => ({
    evidenceCompatible: false as const,
    reason,
    linkingAuthorized: false as const,
    retryAuthorized: false as const,
  });

  if (
    !request ||
    !search ||
    !account ||
    !historical
  ) {
    return reject('MISSING_EVIDENCE');
  }

  let identity: Record<string, string>;

  try {
    identity =
      buildStripeAccountCreationIdentity(request.id);
  } catch {
    return reject('INVALID_REQUEST_ID');
  }

  if (
    typeof request.specialistId !== 'string' ||
    request.specialistId.length === 0 ||
    request.specialistId.length > 255 ||
    request.specialistId.trim() !== request.specialistId ||
    typeof request.country !== 'string' ||
    !/^[A-Z]{2}$/.test(request.country) ||
    request.idempotencyKey !== identity.connectpro_reference
  ) {
    return reject('INVALID_LOCAL_IDENTITY');
  }

  const allowedErrors = [
    'EXTERNAL_TIMEOUT',
    'EXTERNAL_CONNECTION_ERROR',
    'EXTERNAL_RESULT_UNKNOWN',
    'EXTERNAL_RESPONSE_INVALID',
    'LOCAL_PERSISTENCE_ERROR',
    'LOCAL_PROCESSING_ABANDONED',
  ];

  if (
    request.status !== 'UNCERTAIN' ||
    request.livemode !== false ||
    request.attemptCount !== 1 ||
    request.stripeAccountId !== null ||
    request.processingToken !== null ||
    request.processingAt !== null ||
    request.completedAt !== null ||
    !request.firstAttemptAt ||
    !request.lastAttemptAt ||
    typeof request.lastErrorCode !== 'string' ||
    !allowedErrors.includes(request.lastErrorCode)
  ) {
    return reject('INCOMPATIBLE_LOCAL_STATE');
  }

  if (
    search.livemode !== false ||
    account.livemode !== false ||
    historical.livemode !== false ||
    search.evidenceType !== 'ACCOUNT_DISCOVERY' ||
    account.evidenceType !== 'ACCOUNT_METADATA' ||
    historical.evidenceType !== 'STRIPE_EVENT'
  ) {
    return reject('INCOMPATIBLE_EVIDENCE_TYPE');
  }

  if (
    search.requestId !== request.id ||
    account.requestId !== request.id ||
    historical.requestId !== request.id
  ) {
    return reject('REQUEST_ID_MISMATCH');
  }

  if (
    search.linkingAuthorized !== false ||
    search.retryAuthorized !== false ||
    account.linkingAuthorized !== false ||
    historical.linkingAuthorized !== false
  ) {
    return reject('UNEXPECTED_AUTHORIZATION');
  }

  if (
    search.expectedCountry !== request.country ||
    search.searchComplete !== true ||
    search.ambiguous !== false ||
    search.candidateCount !== 1 ||
    !Array.isArray(search.candidates) ||
    search.candidates.length !== 1 ||
    !Number.isSafeInteger(search.pagesScanned) ||
    search.pagesScanned < 1 ||
    search.pagesScanned > 10 ||
    !Number.isSafeInteger(search.accountsScanned) ||
    search.accountsScanned < 1 ||
    search.accountsScanned >
      search.pagesScanned * 100
  ) {
    return reject('INCONCLUSIVE_DISCOVERY');
  }

  const candidate = search.candidates[0];

  if (
    !candidate ||
    typeof candidate.stripeAccountId !== 'string' ||
    candidate.stripeAccountId.length > 255 ||
    !/^acct_[A-Za-z0-9]+$/.test(
      candidate.stripeAccountId,
    ) ||
    candidate.stripeAccountId !==
      account.stripeAccountId ||
    candidate.stripeAccountId !==
      historical.stripeAccountId
  ) {
    return reject('ACCOUNT_ID_MISMATCH');
  }

  if (
    candidate.country !== request.country ||
    candidate.countryMatches !== true ||
    account.country !== request.country ||
    account.countryMatches !== true ||
    account.metadataMatches !== true ||
    account.candidateMatches !== true
  ) {
    return reject('ACCOUNT_EVIDENCE_MISMATCH');
  }

  if (
    typeof historical.stripeEventId !== 'string' ||
    historical.stripeEventId.length > 255 ||
    !/^evt_[A-Za-z0-9_]+$/.test(
      historical.stripeEventId,
    ) ||
    historical.eventTypeMatches !== true ||
    historical.eventContextMatches !== true ||
    historical.accountMatches !== true ||
    historical.countryMatches !== true ||
    historical.metadataMatches !== true ||
    historical.apiRequestPresent !== true ||
    historical.idempotencyMatches !== true ||
    historical.historicalEvidenceMatches !== true
  ) {
    return reject('HISTORICAL_EVIDENCE_MISMATCH');
  }

  const temporal = evaluateStripeEvidenceTime({
    firstAttemptAt: request.firstAttemptAt,
    lastAttemptAt: request.lastAttemptAt,
    eventCreatedAt: historical.eventCreatedAt,
    searchStartedAt: search.observationStartedAt,
    searchCompletedAt: search.searchCompletedAt,
    accountObservedAt: account.observationStartedAt,
    eventObservedAt: historical.observationStartedAt,
  }, now);

  if (temporal.temporalEvidenceMatches !== true) {
    return reject(temporal.reason);
  }

  if (process.env.STRIPE_MODE !== 'test') {
    throw new Error(
      'Conciliacion desactivada',
    );
  }

  return {
    evidenceCompatible: true as const,
    reason: 'COMPLEMENTARY_EVIDENCE_COMPATIBLE',
    requestId: request.id,
    specialistId: request.specialistId,
    stripeAccountId: candidate.stripeAccountId,
    stripeEventId: historical.stripeEventId,
    country: request.country,
    livemode: false as const,
    linkingAuthorized: false as const,
    retryAuthorized: false as const,
  };
}
