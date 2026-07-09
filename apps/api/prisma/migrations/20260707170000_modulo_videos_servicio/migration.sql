-- Módulo "Videos por Servicio": videos educativos (YouTube "No listado") enviados por
-- correo al paciente, parametrizados por servicio y momento relativo a la cita.
-- Migración PURAMENTE ADITIVA: crea 3 enums + 2 tablas + sus índices/FK. No toca ni
-- dropea ningún índice/constraint/columna existente (respeta los 9 índices parciales).
-- El transporte de correo sigue siendo Resend (emailService) — no toca mail_config.

-- ─── Enums ────────────────────────────────────────────────────────────────────
CREATE TYPE "MomentoVideo" AS ENUM ('ANTES', 'DESPUES');
CREATE TYPE "UnidadOffset" AS ENUM ('HORAS', 'DIAS');
CREATE TYPE "EstadoEnvioVideo" AS ENUM ('PENDIENTE', 'ENVIADO', 'CANCELADO', 'ERROR');

-- ─── Tabla servicio_videos ────────────────────────────────────────────────────
CREATE TABLE "servicio_videos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "servicioId" UUID NOT NULL,
    "youtubeVideoId" TEXT NOT NULL,
    "youtubeUrl" TEXT NOT NULL,
    "asunto" TEXT NOT NULL,
    "tituloVideo" TEXT NOT NULL,
    "cuerpoTexto" TEXT NOT NULL,
    "momento" "MomentoVideo" NOT NULL,
    "offsetValor" INTEGER NOT NULL,
    "offsetUnidad" "UnidadOffset" NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "servicio_videos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "servicio_videos_servicioId_activo_idx" ON "servicio_videos"("servicioId", "activo");

ALTER TABLE "servicio_videos" ADD CONSTRAINT "servicio_videos_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Tabla video_envio_logs ───────────────────────────────────────────────────
CREATE TABLE "video_envio_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "citaId" UUID NOT NULL,
    "servicioVideoId" UUID NOT NULL,
    "pacienteEmail" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "estado" "EstadoEnvioVideo" NOT NULL DEFAULT 'PENDIENTE',
    "sentAt" TIMESTAMP(3),
    "errorDetalle" TEXT,
    "motivoCancelacion" TEXT,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "resendEmailId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_envio_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "video_envio_logs_citaId_idx" ON "video_envio_logs"("citaId");
CREATE INDEX "video_envio_logs_servicioVideoId_idx" ON "video_envio_logs"("servicioVideoId");
CREATE INDEX "video_envio_logs_estado_scheduledFor_idx" ON "video_envio_logs"("estado", "scheduledFor");

-- Idempotencia "1 envío por cita+video" mientras el log no esté borrado: índice único
-- PARCIAL (WHERE deletedAt IS NULL). Las transiciones de ciclo de vida ACTUALIZAN la
-- fila (PENDIENTE↔CANCELADO, →ENVIADO); nunca insertan un duplicado.
CREATE UNIQUE INDEX "video_envio_log_cita_video_unico" ON "video_envio_logs"("citaId", "servicioVideoId") WHERE "deletedAt" IS NULL;

ALTER TABLE "video_envio_logs" ADD CONSTRAINT "video_envio_logs_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "video_envio_logs" ADD CONSTRAINT "video_envio_logs_servicioVideoId_fkey" FOREIGN KEY ("servicioVideoId") REFERENCES "servicio_videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
