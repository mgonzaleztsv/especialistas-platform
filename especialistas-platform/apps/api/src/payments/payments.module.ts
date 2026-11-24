import { StripeAccountCreationRequestService } from './stripe-account-creation-request.service';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StripeTestClientService } from './stripe-test-client.service';
import { StripeAccountReaderService } from './stripe-account-reader.service';
import { StripeAccountSyncService } from './stripe-account-sync.service';
import { StripeConnectedAccountService } from './stripe-connected-account.service';
import { StripeWebhookVerifierService } from './stripe-webhook-verifier.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeEventRegistryService } from './stripe-event-registry.service';

import { StripeAccountCandidateSearchService } from './stripe-account-candidate-search.service';
import { StripeAccountCreationEvidenceService } from './stripe-account-creation-evidence.service';
import { StripeAccountEventEvidenceService } from './stripe-account-event-evidence.service';
import { StripeAccountReconciliationService } from './stripe-account-reconciliation.service';

import { StripeAccountCreationService } from './stripe-account-creation.service';

@Module({
  imports: [PrismaModule],
  controllers: [StripeWebhookController],
  providers: [
    StripeAccountCreationService,
    StripeAccountCandidateSearchService,
    StripeAccountCreationEvidenceService,
    StripeAccountEventEvidenceService,
    StripeAccountReconciliationService,
    StripeAccountSyncService,
    StripeAccountCreationRequestService,
    StripeAccountReaderService,
    StripeConnectedAccountService,
    StripeTestClientService,
    StripeWebhookVerifierService,
    StripeEventRegistryService,
  ],
  exports: [
    StripeAccountSyncService,
    StripeAccountCreationRequestService,
    StripeAccountReaderService,
    StripeConnectedAccountService,
    StripeTestClientService,
    StripeWebhookVerifierService,
    StripeEventRegistryService,
  ],
})
export class PaymentsModule {}
