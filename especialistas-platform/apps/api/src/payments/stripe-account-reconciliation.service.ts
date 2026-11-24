import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  PrismaService,
} from '../prisma/prisma.service';

import {
  buildStripeAccountCreationIdentity,
} from './stripe-account-creation-identity';

import {
  StripeAccountCandidateSearchService,
} from './stripe-account-candidate-search.service';

import {
  StripeAccountCreationEvidenceService,
} from './stripe-account-creation-evidence.service';

import {
  StripeAccountEventEvidenceService,
} from './stripe-account-event-evidence.service';

import {
  evaluateStripeReconciliation,
} from './stripe-account-reconciliation-evaluator';

@Injectable()
export class StripeAccountReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly search: StripeAccountCandidateSearchService,
    private readonly accountEvidence: StripeAccountCreationEvidenceService,
    private readonly eventEvidence: StripeAccountEventEvidenceService,
  ) {}

  private assertTestMode(): void {
    if (process.env.STRIPE_MODE !== 'test') {
      throw new ServiceUnavailableException(
        'Conciliacion disponible solo en pruebas',
      );
    }
  }

  private reject(reason: string) {
    return {
      evidenceCompatible: false as const,
      reason,
      linkingAuthorized: false as const,
      retryAuthorized: false as const,
    };
  }

  private async readRequest(requestId: string) {
    return this.prisma.stripeAccountCreationRequest.findUnique({
      where: { id: requestId },
    });
  }

  private fingerprint(request: object): string {
    return JSON.stringify(request);
  }

  async inspectUncertainRequest(
    requestId: string,
    stripeEventId: string,
  ) {
    this.assertTestMode();

    let identity: Record<string, string>;

    try {
      identity =
        buildStripeAccountCreationIdentity(requestId);
    } catch {
      throw new BadRequestException(
        'Identificador de solicitud invalido',
      );
    }

    if (
      typeof stripeEventId !== 'string' ||
      stripeEventId.length > 255 ||
      !/^evt_[A-Za-z0-9_]+$/.test(stripeEventId)
    ) {
      throw new BadRequestException(
        'Identificador de evento invalido',
      );
    }

    const request = await this.readRequest(requestId);

    this.assertTestMode();

    if (!request) {
      throw new NotFoundException(
        'Solicitud Stripe inexistente',
      );
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
      request.id !== requestId ||
      typeof request.specialistId !== 'string' ||
      request.specialistId.length === 0 ||
      request.specialistId.length > 255 ||
      request.specialistId.trim() !== request.specialistId ||
      typeof request.country !== 'string' ||
      !/^[A-Z]{2}$/.test(request.country) ||
      request.status !== 'UNCERTAIN' ||
      request.livemode !== false ||
      request.attemptCount !== 1 ||
      request.idempotencyKey !== identity.connectpro_reference ||
      request.stripeAccountId !== null ||
      request.processingToken !== null ||
      request.processingAt !== null ||
      request.completedAt !== null ||
      typeof request.lastErrorCode !== 'string' ||
      !allowedErrors.includes(request.lastErrorCode) ||
      !(request.firstAttemptAt instanceof Date) ||
      !(request.lastAttemptAt instanceof Date) ||
      !Number.isFinite(request.firstAttemptAt.getTime()) ||
      !Number.isFinite(request.lastAttemptAt.getTime()) ||
      request.firstAttemptAt.getTime() <= 0 ||
      request.firstAttemptAt.getTime() > Date.now() ||
      request.firstAttemptAt.getTime() !==
        request.lastAttemptAt.getTime()
    ) {
      return this.reject('INCOMPATIBLE_LOCAL_STATE');
    }

    const originalFingerprint =
      this.fingerprint(request);

    const connected =
      await this.prisma.stripeConnectedAccount.findUnique({
        where: {
          specialistId: request.specialistId,
        },
        select: { id: true },
      });

    this.assertTestMode();

    if (connected) {
      return this.reject('ACCOUNT_ALREADY_LINKED');
    }

    const search = await this.search.searchCandidates(
      request.id,
      request.country,
    );

    this.assertTestMode();

    if (
      search.requestId !== request.id ||
      search.expectedCountry !== request.country ||
      search.livemode !== false ||
      search.evidenceType !== 'ACCOUNT_DISCOVERY' ||
      search.linkingAuthorized !== false ||
      search.retryAuthorized !== false ||
      search.searchComplete !== true ||
      search.ambiguous !== false ||
      search.candidateCount !== 1 ||
      !Array.isArray(search.candidates) ||
      search.candidates.length !== 1
    ) {
      return this.reject('INCONCLUSIVE_DISCOVERY');
    }

    const candidate = search.candidates[0];

    if (
      !candidate ||
      typeof candidate.stripeAccountId !== 'string' ||
      candidate.stripeAccountId.length > 255 ||
      !/^acct_[A-Za-z0-9]+$/.test(
        candidate.stripeAccountId,
      ) ||
      candidate.country !== request.country ||
      candidate.countryMatches !== true
    ) {
      return this.reject('INVALID_CANDIDATE');
    }

    const account =
      await this.accountEvidence.inspectCandidate(
        request.id,
        candidate.stripeAccountId,
        request.country,
      );

    this.assertTestMode();

    if (
      account.requestId !== request.id ||
      account.stripeAccountId !== candidate.stripeAccountId ||
      account.country !== request.country ||
      account.livemode !== false ||
      account.evidenceType !== 'ACCOUNT_METADATA' ||
      account.countryMatches !== true ||
      account.metadataMatches !== true ||
      account.candidateMatches !== true ||
      account.linkingAuthorized !== false
    ) {
      return this.reject('ACCOUNT_EVIDENCE_MISMATCH');
    }

    const historical =
      await this.eventEvidence.inspectEvent(
        request.id,
        candidate.stripeAccountId,
        stripeEventId,
        request.country,
      );

    this.assertTestMode();

    if (historical.stripeEventId !== stripeEventId) {
      return this.reject('EVENT_ID_MISMATCH');
    }

    const current = await this.readRequest(requestId);

    this.assertTestMode();

    if (
      !current ||
      this.fingerprint(current) !== originalFingerprint
    ) {
      return this.reject('LOCAL_REQUEST_CHANGED');
    }

    const existingAccount =
      await this.prisma.stripeConnectedAccount.findFirst({
        where: {
          OR: [
            {
              specialistId: request.specialistId,
            },
            {
              stripeAccountId: candidate.stripeAccountId,
            },
          ],
        },
        select: { id: true },
      });

    this.assertTestMode();

    if (existingAccount) {
      return this.reject('ACCOUNT_ALREADY_LINKED');
    }

    return evaluateStripeReconciliation(
      current,
      search,
      account,
      historical,
      new Date(),
    );
  }
}
