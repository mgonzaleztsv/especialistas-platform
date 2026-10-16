-- CreateEnum
CREATE TYPE "WorkOrderRespondingParty" AS ENUM ('CLIENT', 'SPECIALIST');

-- CreateEnum
CREATE TYPE "WorkOrderClosureReason" AS ENUM ('CLIENT_REJECTED', 'SPECIALIST_WITHDREW', 'RESPONSE_DEADLINE_EXPIRED');

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closureReason" "WorkOrderClosureReason",
ADD COLUMN     "extensionApprovedAt" TIMESTAMP(3),
ADD COLUMN     "extensionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "reminder24SentAt" TIMESTAMP(3),
ADD COLUMN     "reminder42SentAt" TIMESTAMP(3),
ADD COLUMN     "respondingParty" "WorkOrderRespondingParty",
ADD COLUMN     "responseDeadline" TIMESTAMP(3);
