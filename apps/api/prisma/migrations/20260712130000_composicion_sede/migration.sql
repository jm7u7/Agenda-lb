-- Módulo "Composición de sede" (roster administrativo interno, NO afecta agenda/reservas).
-- Aditiva: crea dos tablas nuevas + sus índices y FKs. No modifica ninguna tabla existente
-- ni ningún índice previo. Generada con `prisma migrate diff` (coincide con el schema).

-- CreateTable
CREATE TABLE "recepcionistas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recepcionistas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asignaciones_administrativas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sedeId" UUID NOT NULL,
    "fechaInicio" DATE NOT NULL,
    "fechaFin" DATE,
    "profesionalId" UUID,
    "recepcionistaId" UUID,
    "notas" TEXT,
    "creadoPor" UUID,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asignaciones_administrativas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asignaciones_administrativas_sedeId_fechaInicio_fechaFin_idx" ON "asignaciones_administrativas"("sedeId", "fechaInicio", "fechaFin");

-- CreateIndex
CREATE INDEX "asignaciones_administrativas_profesionalId_idx" ON "asignaciones_administrativas"("profesionalId");

-- CreateIndex
CREATE INDEX "asignaciones_administrativas_recepcionistaId_idx" ON "asignaciones_administrativas"("recepcionistaId");

-- AddForeignKey
ALTER TABLE "asignaciones_administrativas" ADD CONSTRAINT "asignaciones_administrativas_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asignaciones_administrativas" ADD CONSTRAINT "asignaciones_administrativas_profesionalId_fkey" FOREIGN KEY ("profesionalId") REFERENCES "profesionales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asignaciones_administrativas" ADD CONSTRAINT "asignaciones_administrativas_recepcionistaId_fkey" FOREIGN KEY ("recepcionistaId") REFERENCES "recepcionistas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
