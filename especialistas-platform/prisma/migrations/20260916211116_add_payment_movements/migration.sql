-- CreateEnum
CREATE TYPE "PaymentMovementType" AS ENUM ('SPECIALIST_PAYOUT', 'CLIENT_REFUND', 'PENALTY');

-- CreateTable
CREATE TABLE "PaymentMovement" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "type" "PaymentMovementType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentMovement_paymentId_idx" ON "PaymentMovement"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentMovement_type_idx" ON "PaymentMovement"("type");

-- AddForeignKey
ALTER TABLE "PaymentMovement" ADD CONSTRAINT "PaymentMovement_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
