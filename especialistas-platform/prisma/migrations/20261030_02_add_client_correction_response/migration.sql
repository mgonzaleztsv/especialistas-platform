-- Registrar respuesta del cliente a las correcciones.
-- Se conserva el historial sin sobrescribir respuestas anteriores.
-- No se modifican pagos ni estados existentes.

ALTER TABLE "CompletionClaim"
  ADD COLUMN "clientCorrectionRespondedAt" TIMESTAMP(3),
  ADD COLUMN "clientCorrectionResponseNotes" TEXT;
