-- CreateEnum
CREATE TYPE "DamageClaimType" AS ENUM ('RESTITUTION', 'COMPENSATION', 'BOTH');

-- CreateEnum
CREATE TYPE "DamageClaimStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DISPUTED', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DamageCoverageSource" AS ENUM ('UNDETERMINED', 'RESPONSIBLE_PARTY', 'PLATFORM_INSURANCE', 'PLATFORM');

-- CreateTable
CREATE TABLE "DamageClaim" (
    "id" TEXT NOT NULL,
    "terminationRequestId" TEXT NOT NULL,
    "claimedById" TEXT NOT NULL,
    "claimedAgainst" "TerminationLiability" NOT NULL,
    "type" "DamageClaimType" NOT NULL,
    "description" TEXT NOT NULL,
    "claimedAmount" DECIMAL(10,2),
    "approvedAmount" DECIMAL(10,2),
    "status" "DamageClaimStatus" NOT NULL DEFAULT 'PENDING',
    "coverageSource" "DamageCoverageSource" NOT NULL DEFAULT 'UNDETERMINED',
    "insuranceReference" TEXT,
    "resolutionNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DamageClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DamageClaim_terminationRequestId_idx" ON "DamageClaim"("terminationRequestId");

-- CreateIndex
CREATE INDEX "DamageClaim_claimedById_idx" ON "DamageClaim"("claimedById");

-- CreateIndex
CREATE INDEX "DamageClaim_status_idx" ON "DamageClaim"("status");

-- AddForeignKey
ALTER TABLE "DamageClaim" ADD CONSTRAINT "DamageClaim_terminationRequestId_fkey" FOREIGN KEY ("terminationRequestId") REFERENCES "TerminationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageClaim" ADD CONSTRAINT "DamageClaim_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
