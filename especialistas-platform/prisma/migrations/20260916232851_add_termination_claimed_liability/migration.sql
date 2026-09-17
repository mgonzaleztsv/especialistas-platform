-- AlterTable
ALTER TABLE "TerminationRequest" ADD COLUMN     "claimedLiability" "TerminationLiability" NOT NULL DEFAULT 'UNDETERMINED';
