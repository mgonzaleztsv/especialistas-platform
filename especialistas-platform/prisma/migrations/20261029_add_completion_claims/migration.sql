-- CreateEnum
CREATE TYPE "CompletionClaimStatus" AS ENUM ('PENDING', 'CORRECTION_REQUESTED', 'DISPUTED', 'RESOLVED', 'REJECTED');

-- CreateTable
CREATE TABLE "CompletionClaim" (
    "id" TEXT NOT NULL,
    "jobRequestId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "CompletionClaimStatus" NOT NULL DEFAULT 'PENDING',
    "resolutionNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompletionClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompletionClaim_jobRequestId_status_idx" ON "CompletionClaim"("jobRequestId", "status");

-- CreateIndex
CREATE INDEX "CompletionClaim_clientId_idx" ON "CompletionClaim"("clientId");

-- AddForeignKey
ALTER TABLE "CompletionClaim" ADD CONSTRAINT "CompletionClaim_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletionClaim" ADD CONSTRAINT "CompletionClaim_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
