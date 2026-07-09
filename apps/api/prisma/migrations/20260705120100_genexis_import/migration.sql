-- AlterTable
ALTER TABLE "pacientes" ADD COLUMN     "loteImportacionId" UUID,
ADD COLUMN     "origenImportacion" TEXT,
ADD COLUMN     "requiereActualizacionDatos" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "import_genexis_lotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombreArchivo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "totalFilas" INTEGER NOT NULL,
    "pacientesCreados" INTEGER NOT NULL DEFAULT 0,
    "pacientesActualizados" INTEGER NOT NULL DEFAULT 0,
    "pacientesOmitidos" INTEGER NOT NULL DEFAULT 0,
    "historialInsertado" INTEGER NOT NULL DEFAULT 0,
    "historialOmitido" INTEGER NOT NULL DEFAULT 0,
    "estado" TEXT NOT NULL DEFAULT 'EN_PROCESO',
    "errores" JSONB,
    "importadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importadoPor" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_genexis_lotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historial_genexis" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pacienteId" UUID,
    "tipoDocumento" TEXT NOT NULL,
    "numeroDocumento" TEXT NOT NULL,
    "fechaCita" TEXT NOT NULL,
    "horaCita" TEXT,
    "podologo" TEXT,
    "sede" TEXT,
    "idSucursal" TEXT,
    "servicio" TEXT,
    "obsPaciente" TEXT,
    "obsPodologo" TEXT,
    "consultorio" TEXT,
    "llegoPaciente" TEXT,
    "fechaCreacionGx" TEXT,
    "usuarioCreacionGx" TEXT,
    "hashRegistro" TEXT NOT NULL,
    "loteId" UUID NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "historial_genexis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "historial_genexis_hashRegistro_key" ON "historial_genexis"("hashRegistro");

-- CreateIndex
CREATE INDEX "historial_genexis_pacienteId_fechaCita_idx" ON "historial_genexis"("pacienteId", "fechaCita");

-- CreateIndex
CREATE INDEX "historial_genexis_numeroDocumento_idx" ON "historial_genexis"("numeroDocumento");

-- CreateIndex
CREATE INDEX "historial_genexis_loteId_idx" ON "historial_genexis"("loteId");

