import { Module } from '@nestjs/common';
import { StripeTestClientService } from './stripe-test-client.service';
import { StripeWebhookVerifierService } from './stripe-webhook-verifier.service';
import { StripeWebhookController } from './stripe-webhook.controller';

@Module({
  controllers: [StripeWebhookController],
  providers: [
    StripeTestClientService,
    StripeWebhookVerifierService,
  ],
  exports: [
    StripeTestClientService,
    StripeWebhookVerifierService,
  ],
})
export class PaymentsModule {}
