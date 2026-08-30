-- CreateTable
CREATE TABLE "SpecialistReview" (
    "id" TEXT NOT NULL,
    "jobRequestId" TEXT NOT NULL,
    "specialistId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpecialistReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpecialistReview_jobRequestId_key" ON "SpecialistReview"("jobRequestId");

-- CreateIndex
CREATE INDEX "SpecialistReview_specialistId_idx" ON "SpecialistReview"("specialistId");

-- CreateIndex
CREATE INDEX "SpecialistReview_clientId_idx" ON "SpecialistReview"("clientId");

-- AddForeignKey
ALTER TABLE "SpecialistReview" ADD CONSTRAINT "SpecialistReview_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialistReview" ADD CONSTRAINT "SpecialistReview_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialistReview" ADD CONSTRAINT "SpecialistReview_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
