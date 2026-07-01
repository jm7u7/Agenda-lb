-- Marca de reunión administrativa (Daniel/Yasica) para colorear VERDE en la agenda.
ALTER TABLE "bloqueos_agenda" ADD COLUMN "esReunion" BOOLEAN NOT NULL DEFAULT false;
