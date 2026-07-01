-- Sync de reuniones con el calendario del profesional (Outlook): id de evento + error de sync.
ALTER TABLE "bloqueos_agenda" ADD COLUMN "outlookEventId" TEXT;
ALTER TABLE "bloqueos_agenda" ADD COLUMN "outlookSyncError" TEXT;
