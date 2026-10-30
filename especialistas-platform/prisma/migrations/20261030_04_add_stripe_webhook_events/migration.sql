-- Registro independiente de eventos Stripe.
-- No modifica pagos, transferencias ni órdenes de trabajo.

CREATE TYPE "StripeWebhookEventStatus" AS ENUM (
  'RECEIVED',
  'PROCESSING',
  'PROCESSED',
  'FAILED'
);

CREATE TABLE "StripeWebhookEvent" (
  "id" TEXT NOT NULL,
  "stripeEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "status" "StripeWebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "livemode" BOOLEAN NOT NULL DEFAULT false,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processingAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StripeWebhookEvent_stripeEventId_key"
ON "StripeWebhookEvent"("stripeEventId");

CREATE INDEX "StripeWebhookEvent_status_idx"
ON "StripeWebhookEvent"("status");

CREATE INDEX "StripeWebhookEvent_receivedAt_idx"
ON "StripeWebhookEvent"("receivedAt");

CREATE INDEX "StripeWebhookEvent_eventType_idx"
ON "StripeWebhookEvent"("eventType");
