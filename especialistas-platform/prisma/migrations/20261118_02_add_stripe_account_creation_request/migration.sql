-- CreateEnum
CREATE TYPE "StripeAccountCreationStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'UNCERTAIN');

-- CreateTable
CREATE TABLE "StripeAccountCreationRequest" (
    "id" TEXT NOT NULL,
    "specialistId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "StripeAccountCreationStatus" NOT NULL DEFAULT 'PENDING',
    "country" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "stripeAccountId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "processingToken" TEXT,
    "processingAt" TIMESTAMP(3),
    "firstAttemptAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripeAccountCreationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StripeAccountCreationRequest_specialistId_key" ON "StripeAccountCreationRequest"("specialistId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeAccountCreationRequest_idempotencyKey_key" ON "StripeAccountCreationRequest"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "StripeAccountCreationRequest_stripeAccountId_key" ON "StripeAccountCreationRequest"("stripeAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeAccountCreationRequest_processingToken_key" ON "StripeAccountCreationRequest"("processingToken");

-- CreateIndex
CREATE INDEX "StripeAccountCreationRequest_status_processingAt_idx" ON "StripeAccountCreationRequest"("status", "processingAt");

-- AddForeignKey
ALTER TABLE "StripeAccountCreationRequest" ADD CONSTRAINT "StripeAccountCreationRequest_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
