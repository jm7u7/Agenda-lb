-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public" VERSION "1.6";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "public" VERSION "1.3";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "plpgsql" WITH SCHEMA "pg_catalog" VERSION "1.0";

-- CreateEnum
CREATE TYPE "EstadoCita" AS ENUM ('agendada', 'confirmada', 'llego', 'en_atencion', 'completada', 'no_show', 'cancelada', 'reprogramada');

-- CreateEnum
CREATE TYPE "EstadoConfirmacion" AS ENUM ('pendiente', 'confirmada', 'cancelada');

-- CreateEnum
CREATE TYPE "EstadoRecordatorio" AS ENUM ('PROGRAMADO', 'ENVIADO', 'FALLIDO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "ModoReserva" AS ENUM ('preferencia_opcional', 'sin_eleccion', 'preferencia_obligatoria');

-- CreateEnum
CREATE TYPE "MotivoMovimiento" AS ENUM ('VACACIONES', 'CAMBIO_POR_TIEMPO', 'CERCANIA_A_CASA', 'PROBLEMAS_INTERNOS', 'COBERTURA_EMERGENCIA', 'OTRO');

-- CreateEnum
CREATE TYPE "OrigenAsignacion" AS ENUM ('elegida_por_paciente', 'asignada_automaticamente');

-- CreateEnum
CREATE TYPE "Sexo" AS ENUM ('masculino', 'femenino', 'otro');

-- CreateEnum
CREATE TYPE "TipoBloqueo" AS ENUM ('ALMUERZO', 'CAPACITACION', 'PERMISO', 'OTRO');

-- CreateEnum
CREATE TYPE "TipoDocumento" AS ENUM ('DNI', 'CE', 'PASAPORTE', 'RUC');

-- CreateEnum
CREATE TYPE "TipoProfesional" AS ENUM ('podologa', 'medico', 'fisioterapeuta');

-- CreateEnum
CREATE TYPE "TipoRecordatorio" AS ENUM ('RESERVA', 'RECORDATORIO');

-- CreateEnum
CREATE TYPE "TurnoHorario" AS ENUM ('manana', 'tarde', 'completo');

-- CreateTable
CREATE TABLE "agregados_diarios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fecha" DATE NOT NULL,
    "sedeId" UUID NOT NULL,
    "unidadNegocioId" UUID NOT NULL,
    "profesionalId" UUID,
    "servicioId" UUID NOT NULL,
    "totalCitas" INTEGER NOT NULL DEFAULT 0,
    "completadas" INTEGER NOT NULL DEFAULT 0,
    "noShow" INTEGER NOT NULL DEFAULT 0,
    "canceladas" INTEGER NOT NULL DEFAULT 0,
    "llegaron" INTEGER NOT NULL DEFAULT 0,
    "agendadas" INTEGER NOT NULL DEFAULT 0,
    "confirmadas" INTEGER NOT NULL DEFAULT 0,
    "enAtencion" INTEGER NOT NULL DEFAULT 0,
    "minutosDisponibles" INTEGER NOT NULL DEFAULT 0,
    "minutosAtendidos" INTEGER NOT NULL DEFAULT 0,
    "citasElegidasPorPaciente" INTEGER NOT NULL DEFAULT 0,
    "citasAsignadasAuto" INTEGER NOT NULL DEFAULT 0,
    "sucio" BOOLEAN NOT NULL DEFAULT false,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agregados_diarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "usuarioId" UUID,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "ultimoUso" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asignaciones_sede" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profesionalId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "fechaInicio" DATE NOT NULL,
    "fechaFin" DATE,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "creadoPor" UUID,
    "motivo" "MotivoMovimiento" NOT NULL DEFAULT 'OTRO',
    "notas" TEXT,
    "reemplazaA" UUID,
    "cierraAsignacionId" UUID,
    "cierraFechaFin" DATE,

    CONSTRAINT "asignaciones_sede_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "citaId" UUID,
    "usuarioId" UUID,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidadId" UUID NOT NULL,
    "antes" JSONB,
    "despues" JSONB,
    "sedeId" UUID,
    "ip" TEXT,
    "userAgent" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bloqueos_agenda" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profesionalId" UUID NOT NULL,
    "fechaInicio" TIMESTAMP(3) NOT NULL,
    "fechaFin" TIMESTAMP(3) NOT NULL,
    "motivo" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "creadoPor" UUID,
    "duracionMin" INTEGER NOT NULL DEFAULT 60,
    "esRecurrente" BOOLEAN NOT NULL DEFAULT false,
    "horaFin" TEXT,
    "horaInicio" TEXT,
    "sedeId" UUID,
    "tipo" "TipoBloqueo" NOT NULL DEFAULT 'OTRO',

    CONSTRAINT "bloqueos_agenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "valor" TEXT NOT NULL,
    "etiqueta" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pacienteId" UUID NOT NULL,
    "profesionalId" UUID,
    "sedeId" UUID NOT NULL,
    "unidadNegocioId" UUID NOT NULL,
    "servicioId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "duracionMinutos" INTEGER NOT NULL,
    "estado" "EstadoCita" NOT NULL DEFAULT 'agendada',
    "canal" TEXT NOT NULL DEFAULT 'recepcion',
    "origenAsignacion" "OrigenAsignacion",
    "comentarioRecepcion" TEXT,
    "comentarioProfesional" TEXT,
    "paquetePacienteId" UUID,
    "sesionNumero" INTEGER,
    "motivoCancelacion" TEXT,
    "citaOriginalId" UUID,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "consultorioNumero" INTEGER,
    "comprobanteMimeType" TEXT,
    "comprobanteNombre" TEXT,
    "comprobanteSubidoEn" TIMESTAMP(3),
    "comprobanteSubidoPor" UUID,
    "comprobanteUrl" TEXT,
    "confirmacionEnviadaEn" TIMESTAMP(3),
    "confirmacionToken" TEXT,
    "confirmadaEn" TIMESTAMP(3),
    "estadoConfirmacion" "EstadoConfirmacion" NOT NULL DEFAULT 'pendiente',
    "outlookEventId" TEXT,
    "outlookSyncError" TEXT,
    "creadoPorUsuarioId" UUID,
    "idempotencyKey" TEXT,
    "solicitadoProfesionalId" UUID,
    "sesionConsumida" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "citas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competencias_profesional" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profesionalId" UUID NOT NULL,
    "servicioId" UUID NOT NULL,
    "habilitadoDesde" DATE NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "soloPorSolicitud" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "competencias_profesional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entradas_podologa" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profesionalId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "creadoPor" UUID,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entradas_podologa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "excepciones_horario" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sedeId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "abierto" BOOLEAN NOT NULL DEFAULT true,
    "horaApertura" TEXT,
    "horaCierre" TEXT,
    "nota" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "excepciones_horario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "horarios_profesional" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profesionalId" UUID NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "horaFin" TEXT NOT NULL,
    "turno" "TurnoHorario" NOT NULL DEFAULT 'completo',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "horarios_profesional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_config" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT NOT NULL DEFAULT 'Limablue Podología',
    "provider" TEXT NOT NULL DEFAULT 'gmail',
    "refreshToken" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificaciones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mensaje" VARCHAR(500) NOT NULL,
    "creadoPor" UUID NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activaDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activaHasta" TIMESTAMP(3) NOT NULL,
    "todasLasSedes" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notificaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificaciones_sede" (
    "notificacionId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,

    CONSTRAINT "notificaciones_sede_pkey" PRIMARY KEY ("notificacionId","sedeId")
);

-- CreateTable
CREATE TABLE "notificaciones_vista" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notificacionId" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "vistaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificaciones_vista_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pacientes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombres" TEXT NOT NULL,
    "apellidoPaterno" TEXT NOT NULL,
    "apellidoMaterno" TEXT NOT NULL,
    "tipoDocumento" "TipoDocumento" NOT NULL DEFAULT 'DNI',
    "numeroDocumento" TEXT NOT NULL,
    "fechaNacimiento" DATE,
    "sexo" "Sexo",
    "telefono" TEXT NOT NULL,
    "email" TEXT,
    "notas" TEXT,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pacientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paquetes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "servicioId" UUID NOT NULL,
    "totalSesiones" INTEGER NOT NULL,
    "consumeNoShow" BOOLEAN NOT NULL DEFAULT false,
    "precio" DECIMAL(10,2),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paquetes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paquetes_paciente" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pacienteId" UUID NOT NULL,
    "paqueteId" UUID NOT NULL,
    "fechaCompra" DATE NOT NULL,
    "sesionesTotal" INTEGER NOT NULL,
    "sesionesUsadas" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "notas" TEXT,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paquetes_paciente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profesionales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombres" TEXT NOT NULL,
    "apellidos" TEXT NOT NULL,
    "tipo" "TipoProfesional" NOT NULL,
    "unidadNegocioId" UUID NOT NULL,
    "colorAvatar" TEXT NOT NULL DEFAULT '#6B7F9E',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "soloPorSolicitud" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "profesionales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recordatorios_cita" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "citaId" UUID NOT NULL,
    "tipo" "TipoRecordatorio" NOT NULL,
    "programadoPara" TIMESTAMP(3) NOT NULL,
    "estado" "EstadoRecordatorio" NOT NULL DEFAULT 'PROGRAMADO',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "gmailMessageId" TEXT,
    "jobId" TEXT,
    "clickConfirmarAt" TIMESTAMP(3),
    "clickReprogramarAt" TIMESTAMP(3),
    "confirmadoAt" TIMESTAMP(3),
    "errorMensaje" TEXT,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "enviadoAt" TIMESTAMP(3),

    CONSTRAINT "recordatorios_cita_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "descripcion" TEXT,
    "permisos" TEXT[],
    "esSistema" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sede_unidad_negocio" (
    "sedeId" UUID NOT NULL,
    "unidadNegocioId" UUID NOT NULL,

    CONSTRAINT "sede_unidad_negocio_pkey" PRIMARY KEY ("sedeId","unidadNegocioId")
);

-- CreateTable
CREATE TABLE "sedes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3B82F6',
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "horario" JSONB NOT NULL DEFAULT '{}',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sedes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "duracionMinutos" INTEGER NOT NULL DEFAULT 30,
    "color" TEXT NOT NULL DEFAULT '#6B7F9E',
    "precioReferencial" DECIMAL(10,2),
    "unidadNegocioId" UUID NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "servicios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens_accion_cita" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token" TEXT NOT NULL,
    "citaId" UUID NOT NULL,
    "accion" TEXT NOT NULL,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "usadoAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tokens_accion_cita_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unidades_negocio" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "modoReserva" "ModoReserva" NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366F1',
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unidades_negocio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "rol" TEXT NOT NULL DEFAULT 'recepcionista',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios_sedes" (
    "usuarioId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,

    CONSTRAINT "usuarios_sedes_pkey" PRIMARY KEY ("usuarioId","sedeId")
);

-- CreateTable
CREATE TABLE "webhook_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subscriptionId" UUID NOT NULL,
    "evento" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "statusCode" INTEGER,
    "respuesta" TEXT,
    "intentos" INTEGER NOT NULL DEFAULT 1,
    "exitoso" BOOLEAN NOT NULL DEFAULT false,
    "proximoIntento" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "eventos" TEXT[],
    "sedeId" UUID,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agregados_diarios_fecha_profesionalId_idx" ON "agregados_diarios"("fecha" ASC, "profesionalId" ASC);

-- CreateIndex
CREATE INDEX "agregados_diarios_fecha_sedeId_idx" ON "agregados_diarios"("fecha" ASC, "sedeId" ASC);

-- CreateIndex
CREATE INDEX "agregados_diarios_fecha_sedeId_unidadNegocioId_idx" ON "agregados_diarios"("fecha" ASC, "sedeId" ASC, "unidadNegocioId" ASC);

-- CreateIndex
CREATE INDEX "agregados_diarios_fecha_unidadNegocioId_idx" ON "agregados_diarios"("fecha" ASC, "unidadNegocioId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash" ASC);

-- CreateIndex
CREATE INDEX "asignaciones_sede_fechaInicio_fechaFin_idx" ON "asignaciones_sede"("fechaInicio" ASC, "fechaFin" ASC);

-- CreateIndex
CREATE INDEX "asignaciones_sede_profesionalId_activa_idx" ON "asignaciones_sede"("profesionalId" ASC, "activa" ASC);

-- CreateIndex
CREATE INDEX "asignaciones_sede_sedeId_activa_idx" ON "asignaciones_sede"("sedeId" ASC, "activa" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_citaId_idx" ON "audit_logs"("citaId" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_entidad_entidadId_idx" ON "audit_logs"("entidad" ASC, "entidadId" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_sedeId_creadoEn_idx" ON "audit_logs"("sedeId" ASC, "creadoEn" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_usuarioId_idx" ON "audit_logs"("usuarioId" ASC);

-- CreateIndex
CREATE INDEX "bloqueos_agenda_profesionalId_fechaInicio_fechaFin_idx" ON "bloqueos_agenda"("profesionalId" ASC, "fechaInicio" ASC, "fechaFin" ASC);

-- CreateIndex
CREATE INDEX "bloqueos_agenda_sedeId_tipo_esRecurrente_idx" ON "bloqueos_agenda"("sedeId" ASC, "tipo" ASC, "esRecurrente" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "canales_valor_key" ON "canales"("valor" ASC);

-- CreateIndex
CREATE INDEX "citas_estado_idx" ON "citas"("estado" ASC);

-- CreateIndex
CREATE INDEX "citas_idempotencyKey_idx" ON "citas"("idempotencyKey" ASC);

-- CreateIndex
CREATE INDEX "citas_pacienteId_idx" ON "citas"("pacienteId" ASC);

-- CreateIndex
CREATE INDEX "citas_profesionalId_fecha_idx" ON "citas"("profesionalId" ASC, "fecha" ASC);

-- CreateIndex
CREATE INDEX "citas_sedeId_fecha_idx" ON "citas"("sedeId" ASC, "fecha" ASC);

-- CreateIndex
CREATE INDEX "citas_unidadNegocioId_fecha_idx" ON "citas"("unidadNegocioId" ASC, "fecha" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "competencias_profesional_profesionalId_servicioId_key" ON "competencias_profesional"("profesionalId" ASC, "servicioId" ASC);

-- CreateIndex
CREATE INDEX "competencias_profesional_servicioId_activa_idx" ON "competencias_profesional"("servicioId" ASC, "activa" ASC);

-- CreateIndex
CREATE INDEX "entradas_podologa_fecha_idx" ON "entradas_podologa"("fecha" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "entradas_podologa_profesionalId_fecha_key" ON "entradas_podologa"("profesionalId" ASC, "fecha" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "excepciones_horario_sedeId_fecha_key" ON "excepciones_horario"("sedeId" ASC, "fecha" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "horarios_profesional_profesionalId_diaSemana_key" ON "horarios_profesional"("profesionalId" ASC, "diaSemana" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "notificaciones_vista_notificacionId_usuarioId_key" ON "notificaciones_vista"("notificacionId" ASC, "usuarioId" ASC);

-- CreateIndex
CREATE INDEX "pacientes_numeroDocumento_idx" ON "pacientes"("numeroDocumento" ASC);

-- CreateIndex
CREATE INDEX "pacientes_telefono_idx" ON "pacientes"("telefono" ASC);

-- CreateIndex
CREATE INDEX "paquetes_paciente_pacienteId_activo_idx" ON "paquetes_paciente"("pacienteId" ASC, "activo" ASC);

-- CreateIndex
CREATE INDEX "profesionales_activo_idx" ON "profesionales"("activo" ASC);

-- CreateIndex
CREATE INDEX "recordatorios_cita_citaId_idx" ON "recordatorios_cita"("citaId" ASC);

-- CreateIndex
CREATE INDEX "recordatorios_cita_estado_programadoPara_idx" ON "recordatorios_cita"("estado" ASC, "programadoPara" ASC);

-- CreateIndex
CREATE INDEX "recordatorios_cita_programadoPara_idx" ON "recordatorios_cita"("programadoPara" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "roles_nombre_key" ON "roles"("nombre" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "sedes_nombre_key" ON "sedes"("nombre" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "servicios_codigo_key" ON "servicios"("codigo" ASC);

-- CreateIndex
CREATE INDEX "servicios_unidadNegocioId_activo_idx" ON "servicios"("unidadNegocioId" ASC, "activo" ASC);

-- CreateIndex
CREATE INDEX "tokens_accion_cita_citaId_idx" ON "tokens_accion_cita"("citaId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "tokens_accion_cita_token_key" ON "tokens_accion_cita"("token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "unidades_negocio_nombre_key" ON "unidades_negocio"("nombre" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email" ASC);

-- CreateIndex
CREATE INDEX "webhook_logs_subscriptionId_creadoEn_idx" ON "webhook_logs"("subscriptionId" ASC, "creadoEn" ASC);

-- AddForeignKey
ALTER TABLE "agregados_diarios" ADD CONSTRAINT "agregados_diarios_profesionalId_fkey" FOREIGN KEY ("profesionalId") REFERENCES "profesionales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agregados_diarios" ADD CONSTRAINT "agregados_diarios_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agregados_diarios" ADD CONSTRAINT "agregados_diarios_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agregados_diarios" ADD CONSTRAINT "agregados_diarios_unidadNegocioId_fkey" FOREIGN KEY ("unidadNegocioId") REFERENCES "unidades_negocio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asignaciones_sede" ADD CONSTRAINT "asignaciones_sede_creadoPor_fkey" FOREIGN KEY ("creadoPor") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asignaciones_sede" ADD CONSTRAINT "asignaciones_sede_profesionalId_fkey" FOREIGN KEY ("profesionalId") REFERENCES "profesionales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asignaciones_sede" ADD CONSTRAINT "asignaciones_sede_reemplazaA_fkey" FOREIGN KEY ("reemplazaA") REFERENCES "profesionales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asignaciones_sede" ADD CONSTRAINT "asignaciones_sede_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "citas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueos_agenda" ADD CONSTRAINT "bloqueos_agenda_creadoPor_fkey" FOREIGN KEY ("creadoPor") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueos_agenda" ADD CONSTRAINT "bloqueos_agenda_profesionalId_fkey" FOREIGN KEY ("profesionalId") REFERENCES "profesionales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueos_agenda" ADD CONSTRAINT "bloqueos_agenda_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_citaOriginalId_fkey" FOREIGN KEY ("citaOriginalId") REFERENCES "citas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_creadoPorUsuarioId_fkey" FOREIGN KEY ("creadoPorUsuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_paquetePacienteId_fkey" FOREIGN KEY ("paquetePacienteId") REFERENCES "paquetes_paciente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_profesionalId_fkey" FOREIGN KEY ("profesionalId") REFERENCES "profesionales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_solicitadoProfesionalId_fkey" FOREIGN KEY ("solicitadoProfesionalId") REFERENCES "profesionales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_unidadNegocioId_fkey" FOREIGN KEY ("unidadNegocioId") REFERENCES "unidades_negocio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competencias_profesional" ADD CONSTRAINT "competencias_profesional_profesionalId_fkey" FOREIGN KEY ("profesionalId") REFERENCES "profesionales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competencias_profesional" ADD CONSTRAINT "competencias_profesional_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas_podologa" ADD CONSTRAINT "entradas_podologa_profesionalId_fkey" FOREIGN KEY ("profesionalId") REFERENCES "profesionales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "excepciones_horario" ADD CONSTRAINT "excepciones_horario_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "horarios_profesional" ADD CONSTRAINT "horarios_profesional_profesionalId_fkey" FOREIGN KEY ("profesionalId") REFERENCES "profesionales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_creadoPor_fkey" FOREIGN KEY ("creadoPor") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones_sede" ADD CONSTRAINT "notificaciones_sede_notificacionId_fkey" FOREIGN KEY ("notificacionId") REFERENCES "notificaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones_sede" ADD CONSTRAINT "notificaciones_sede_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones_vista" ADD CONSTRAINT "notificaciones_vista_notificacionId_fkey" FOREIGN KEY ("notificacionId") REFERENCES "notificaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones_vista" ADD CONSTRAINT "notificaciones_vista_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paquetes" ADD CONSTRAINT "paquetes_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paquetes_paciente" ADD CONSTRAINT "paquetes_paciente_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paquetes_paciente" ADD CONSTRAINT "paquetes_paciente_paqueteId_fkey" FOREIGN KEY ("paqueteId") REFERENCES "paquetes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profesionales" ADD CONSTRAINT "profesionales_unidadNegocioId_fkey" FOREIGN KEY ("unidadNegocioId") REFERENCES "unidades_negocio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordatorios_cita" ADD CONSTRAINT "recordatorios_cita_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sede_unidad_negocio" ADD CONSTRAINT "sede_unidad_negocio_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sede_unidad_negocio" ADD CONSTRAINT "sede_unidad_negocio_unidadNegocioId_fkey" FOREIGN KEY ("unidadNegocioId") REFERENCES "unidades_negocio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios" ADD CONSTRAINT "servicios_unidadNegocioId_fkey" FOREIGN KEY ("unidadNegocioId") REFERENCES "unidades_negocio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens_accion_cita" ADD CONSTRAINT "tokens_accion_cita_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios_sedes" ADD CONSTRAINT "usuarios_sedes_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios_sedes" ADD CONSTRAINT "usuarios_sedes_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Índices únicos PARCIALES (Prisma no los representa en el schema → van en SQL crudo
-- aquí, NO en seed.ts). Reglas de integridad de la última línea de defensa:
--  • citas_slot_activo_unique     : anti doble-booking (solo citas activas).
--  • recordatorios_cita_unico     : un recordatorio activo por cita+tipo.
--  • asignaciones_sede_una_abierta: una sola asignación abierta por profesional.
--  • pacientes_documento_unico    : sin pacientes duplicados (documento) vivos.
--  • citas_idempotency_unico      : sin citas duplicadas por idempotencyKey.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "citas_slot_activo_unique" ON "citas" ("profesionalId", "fecha", "horaInicio") WHERE estado NOT IN ('cancelada','no_show','reprogramada') AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "recordatorios_cita_unico" ON "recordatorios_cita" ("citaId", "tipo") WHERE estado <> 'CANCELADO' AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "asignaciones_sede_una_abierta" ON "asignaciones_sede" ("profesionalId") WHERE "fechaFin" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "pacientes_documento_unico" ON "pacientes" ("tipoDocumento", "numeroDocumento") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "citas_idempotency_unico" ON "citas" ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL AND "deletedAt" IS NULL;
