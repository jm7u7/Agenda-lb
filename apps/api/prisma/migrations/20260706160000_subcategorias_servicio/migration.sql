-- CreateTable
CREATE TABLE "subcategorias_servicio" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "servicioId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "precioReferencial" DECIMAL(10,2),
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subcategorias_servicio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subcategorias_servicio_servicioId_activo_idx" ON "subcategorias_servicio"("servicioId", "activo");

-- CreateIndex (único PARCIAL: nombre único por servicio mientras no esté borrado)
CREATE UNIQUE INDEX "subcategorias_servicio_nombre_unico" ON "subcategorias_servicio"("servicioId", "nombre") WHERE "deletedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "subcategorias_servicio" ADD CONSTRAINT "subcategorias_servicio_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "citas" ADD COLUMN "subcategoriaId" UUID;

-- CreateIndex
CREATE INDEX "citas_subcategoriaId_idx" ON "citas"("subcategoriaId");

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_subcategoriaId_fkey" FOREIGN KEY ("subcategoriaId") REFERENCES "subcategorias_servicio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
