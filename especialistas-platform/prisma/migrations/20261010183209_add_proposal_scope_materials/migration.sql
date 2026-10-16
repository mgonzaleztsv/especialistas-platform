-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN     "excludedScope" TEXT,
ADD COLUMN     "includedScope" TEXT,
ADD COLUMN     "materialsAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
