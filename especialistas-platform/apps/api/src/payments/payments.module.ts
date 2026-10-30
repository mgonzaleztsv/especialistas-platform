import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StripeTestClientService } from './stripe-test-client.service';
import { StripeWebhookVerifierService } from './stripe-webhook-verifier.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeEventRegistryService } from './stripe-event-registry.service';

@Module({
  imports: [PrismaModule],
  controllers: [StripeWebhookController],
  providers: [
    StripeTestClientService,
    StripeWebhookVerifierService,
    StripeEventRegistryService,
  ],
  exports: [
    StripeTestClientService,
    StripeWebhookVerifierService,
    StripeEventRegistryService,
  ],
})
export class PaymentsModule {}
