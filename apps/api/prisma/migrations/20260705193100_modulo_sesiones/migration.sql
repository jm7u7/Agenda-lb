-- AlterTable
ALTER TABLE "paquetes" ADD COLUMN     "composicion" JSONB,
ADD COLUMN     "duracionMeses" INTEGER,
ADD COLUMN     "promocionId" UUID,
ADD COLUMN     "sedesHabilitadas" JSONB,
ADD COLUMN     "tipo" TEXT NOT NULL DEFAULT 'PAQUETE';

-- AlterTable
ALTER TABLE "paquetes_paciente" ADD COLUMN     "composicion" JSONB,
ADD COLUMN     "estado" TEXT NOT NULL DEFAULT 'ACTIVO',
ADD COLUMN     "familiaId" UUID,
ADD COLUMN     "origen" TEXT NOT NULL DEFAULT 'AGENDA',
ADD COLUMN     "promocionId" UUID,
ADD COLUMN     "sedeId" UUID,
ADD COLUMN     "servicioNuevoId" UUID,
ADD COLUMN     "tipo" TEXT NOT NULL DEFAULT 'PAQUETE',
ADD COLUMN     "vigenciaFin" TEXT,
ADD COLUMN     "vigenciaInicio" TEXT;

-- CreateTable
CREATE TABLE "familias_paquete_genexis" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombreFamilia" TEXT NOT NULL,
    "patronesServicio" JSONB NOT NULL,
    "patronesObs" JSONB,
    "mapeoServicio" JSONB,
    "tipo" TEXT NOT NULL,
    "sesionesTotales" INTEGER,
    "composicion" JSONB,
    "duracionMeses" INTEGER,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "familias_paquete_genexis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumos_sesion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "paqueteId" UUID NOT NULL,
    "tipoSesion" UUID,
    "citaId" UUID,
    "historialGenexisId" UUID,
    "fecha" TEXT NOT NULL,
    "origen" TEXT NOT NULL,
    "motivo" TEXT,
    "registradoPorId" UUID,
    "registradoPor" TEXT,
    "anuladoMotivo" TEXT,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consumos_sesion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conciliaciones_apertura" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pacienteId" UUID NOT NULL,
    "familiaId" UUID NOT NULL,
    "paquetePacienteId" UUID,
    "lecturaServicio" INTEGER,
    "lecturaObs" INTEGER,
    "consumoPropuesto" INTEGER,
    "consumoAprobado" INTEGER,
    "ajusteProCliente" BOOLEAN NOT NULL DEFAULT false,
    "confianza" TEXT NOT NULL,
    "sedeInferidaId" UUID,
    "sedeAprobadaId" UUID,
    "servicioResueltoId" UUID,
    "vigenciaFinEstimada" TEXT,
    "flagVigencia" BOOLEAN NOT NULL DEFAULT false,
    "evidenciaIds" JSONB NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "valoresOriginales" JSONB,
    "decididoPor" TEXT,
    "decididoEn" TIMESTAMP(3),
    "notas" TEXT,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conciliaciones_apertura_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "familias_paquete_genexis_nombreFamilia_key" ON "familias_paquete_genexis"("nombreFamilia");

-- CreateIndex
CREATE INDEX "consumos_sesion_paqueteId_deletedAt_idx" ON "consumos_sesion"("paqueteId", "deletedAt");

-- CreateIndex
CREATE INDEX "consumos_sesion_citaId_idx" ON "consumos_sesion"("citaId");

-- CreateIndex
CREATE INDEX "conciliaciones_apertura_estado_confianza_idx" ON "conciliaciones_apertura"("estado", "confianza");

-- CreateIndex
CREATE INDEX "conciliaciones_apertura_pacienteId_idx" ON "conciliaciones_apertura"("pacienteId");

-- CreateIndex
CREATE INDEX "conciliaciones_apertura_familiaId_estado_idx" ON "conciliaciones_apertura"("familiaId", "estado");

-- CreateIndex
CREATE INDEX "paquetes_paciente_pacienteId_servicioNuevoId_sedeId_estado_idx" ON "paquetes_paciente"("pacienteId", "servicioNuevoId", "sedeId", "estado");

-- AddForeignKey
ALTER TABLE "paquetes" ADD CONSTRAINT "paquetes_promocionId_fkey" FOREIGN KEY ("promocionId") REFERENCES "promociones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paquetes_paciente" ADD CONSTRAINT "paquetes_paciente_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paquetes_paciente" ADD CONSTRAINT "paquetes_paciente_servicioNuevoId_fkey" FOREIGN KEY ("servicioNuevoId") REFERENCES "servicios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paquetes_paciente" ADD CONSTRAINT "paquetes_paciente_familiaId_fkey" FOREIGN KEY ("familiaId") REFERENCES "familias_paquete_genexis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumos_sesion" ADD CONSTRAINT "consumos_sesion_paqueteId_fkey" FOREIGN KEY ("paqueteId") REFERENCES "paquetes_paciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumos_sesion" ADD CONSTRAINT "consumos_sesion_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "citas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conciliaciones_apertura" ADD CONSTRAINT "conciliaciones_apertura_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conciliaciones_apertura" ADD CONSTRAINT "conciliaciones_apertura_familiaId_fkey" FOREIGN KEY ("familiaId") REFERENCES "familias_paquete_genexis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conciliaciones_apertura" ADD CONSTRAINT "conciliaciones_apertura_paquetePacienteId_fkey" FOREIGN KEY ("paquetePacienteId") REFERENCES "paquetes_paciente"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Máximo 1 consumo VIVO por cita (índice único PARCIAL — Prisma no lo representa
-- en el schema; vive aquí como SQL crudo, igual que los otros índices parciales).
CREATE UNIQUE INDEX IF NOT EXISTS "consumos_cita_unico" ON "consumos_sesion" ("citaId") WHERE "citaId" IS NOT NULL AND "deletedAt" IS NULL;
