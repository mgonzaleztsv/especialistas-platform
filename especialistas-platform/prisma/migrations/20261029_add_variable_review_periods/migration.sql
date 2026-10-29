-- AlterTable
ALTER TABLE "JobRequest" ADD COLUMN     "reviewDeadline" TIMESTAMP(3),
ADD COLUMN     "reviewPeriodHours" INTEGER,
ADD COLUMN     "workCompletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "reviewPeriodHours" INTEGER;
