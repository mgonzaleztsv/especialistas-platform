-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('PENDING_ACCEPTANCE', 'ACCEPTED', 'SUPERSEDED', 'CANCELLED');

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "jobRequestId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'PENDING_ACCEPTANCE',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "includedScope" TEXT,
    "excludedScope" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zipcode" TEXT,
    "scheduledDate" TIMESTAMP(3),
    "laborAmount" DECIMAL(10,2) NOT NULL,
    "materialsAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "templateVersion" TEXT NOT NULL DEFAULT '0.1',
    "clientAcceptedAt" TIMESTAMP(3),
    "specialistAcceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkOrder_proposalId_idx" ON "WorkOrder"("proposalId");

-- CreateIndex
CREATE INDEX "WorkOrder_status_idx" ON "WorkOrder"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_jobRequestId_version_key" ON "WorkOrder"("jobRequestId", "version");

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
