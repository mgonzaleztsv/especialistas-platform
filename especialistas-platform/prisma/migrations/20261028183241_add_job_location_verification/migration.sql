-- CreateEnum
CREATE TYPE "JobLocationVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'REJECTED');

-- AlterTable
ALTER TABLE "JobRequest" ADD COLUMN     "locationVerificationStatus" "JobLocationVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED';
