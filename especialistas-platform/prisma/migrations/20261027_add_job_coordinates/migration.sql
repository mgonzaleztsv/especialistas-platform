-- Add optional coordinates for job locations.
ALTER TABLE "JobRequest"
  ADD COLUMN "latitude" DECIMAL(10,7),
  ADD COLUMN "longitude" DECIMAL(10,7);
