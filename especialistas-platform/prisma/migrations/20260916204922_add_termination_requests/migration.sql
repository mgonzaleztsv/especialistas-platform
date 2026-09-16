-- CreateEnum
CREATE TYPE "TerminationRequesterRole" AS ENUM ('CLIENT', 'SPECIALIST');

-- CreateEnum
CREATE TYPE "TerminationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DISPUTED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "TerminationLiability" AS ENUM ('UNDETERMINED', 'CLIENT', 'SPECIALIST', 'NONE');

-- CreateTable
CREATE TABLE "TerminationRequest" (
    "id" TEXT NOT NULL,
    "jobRequestId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requesterRole" "TerminationRequesterRole" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "reasonDetails" TEXT,
    "status" "TerminationStatus" NOT NULL DEFAULT 'PENDING',
    "liability" "TerminationLiability" NOT NULL DEFAULT 'UNDETERMINED',
    "specialistPayoutAmount" DECIMAL(10,2),
    "clientRefundAmount" DECIMAL(10,2),
    "penaltyAmount" DECIMAL(10,2),
    "resolutionNotes" TEXT,
    "respondedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TerminationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TerminationRequest_jobRequestId_key" ON "TerminationRequest"("jobRequestId");

-- CreateIndex
CREATE INDEX "TerminationRequest_requestedById_idx" ON "TerminationRequest"("requestedById");

-- CreateIndex
CREATE INDEX "TerminationRequest_status_idx" ON "TerminationRequest"("status");

-- AddForeignKey
ALTER TABLE "TerminationRequest" ADD CONSTRAINT "TerminationRequest_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerminationRequest" ADD CONSTRAINT "TerminationRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
