-- Fecha real de inicio de disputa.
-- Las reclamaciones anteriores conservan NULL.
-- No modifica pagos, estados ni resoluciones.

ALTER TABLE "CompletionClaim"
  ADD COLUMN "disputedAt" TIMESTAMP(3);
