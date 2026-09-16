/*
  Warnings:

  - Added the required column `jobStatusAtRequest` to the `TerminationRequest` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TerminationRequest" ADD COLUMN     "jobStatusAtRequest" "JobRequestStatus" NOT NULL;
