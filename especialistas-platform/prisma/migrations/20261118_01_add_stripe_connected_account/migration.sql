-- CreateTable
CREATE TABLE "StripeConnectedAccount" (
    "id" TEXT NOT NULL,
    "specialistId" TEXT NOT NULL,
    "stripeAccountId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "detailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "chargesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "transfersCapability" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripeConnectedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StripeConnectedAccount_specialistId_key" ON "StripeConnectedAccount"("specialistId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeConnectedAccount_stripeAccountId_key" ON "StripeConnectedAccount"("stripeAccountId");

-- AddForeignKey
ALTER TABLE "StripeConnectedAccount" ADD CONSTRAINT "StripeConnectedAccount_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
