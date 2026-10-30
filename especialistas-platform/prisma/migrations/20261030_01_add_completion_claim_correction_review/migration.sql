-- Seguimiento de correcciones de reclamaciones por finalización.
-- Todos los campos admiten NULL para conservar los registros existentes.
-- Esta migración no modifica pagos ni estados de trabajos.

ALTER TABLE "CompletionClaim"
  ADD COLUMN "correctionCompletedAt" TIMESTAMP(3),
  ADD COLUMN "correctionReviewDeadline" TIMESTAMP(3),
  ADD COLUMN "correctionCompletionNotes" TEXT,
  ADD COLUMN "clientCorrectionAcceptedAt" TIMESTAMP(3);
