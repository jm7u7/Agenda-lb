-- Lista de exclusión de VIDEOS EDUCATIVOS: correos que no deben recibir los videos del
-- módulo (los correos de confirmación/recordatorio NO se ven afectados).
-- Migración PURAMENTE ADITIVA: crea 1 tabla + su índice + único parcial. No toca nada existente.
CREATE TABLE "video_supresiones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "motivo" TEXT,
    "creadoPor" UUID,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_supresiones_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "video_supresiones_email_idx" ON "video_supresiones"("email");

-- Único por email mientras esté activo (índice parcial WHERE deletedAt IS NULL).
CREATE UNIQUE INDEX "video_supresiones_email_unico" ON "video_supresiones"("email") WHERE "deletedAt" IS NULL;
