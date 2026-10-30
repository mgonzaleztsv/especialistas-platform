CREATE UNIQUE INDEX "CompletionClaim_one_open_per_job_idx"
ON "CompletionClaim" ("jobRequestId")
WHERE "status" IN (
  'PENDING',
  'CORRECTION_REQUESTED',
  'DISPUTED'
);
