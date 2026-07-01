-- Promociones configurables (administrables desde Herramientas) + vínculo opcional en la cita.
-- Migración PURAMENTE ADITIVA: no toca ningún índice/constraint existente.

-- ─── Enum TipoPromocion ───────────────────────────────────────────────────────
CREATE TYPE "TipoPromocion" AS ENUM ('PRECIO_FIJO', 'PORCENTAJE', 'OTRO');

-- ─── Tabla promociones ────────────────────────────────────────────────────────
CREATE TABLE "promociones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "tipo" "TipoPromocion" NOT NULL DEFAULT 'OTRO',
    "valor" DECIMAL(10,2),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promociones_pkey" PRIMARY KEY ("id")
);

-- Único por nombre mientras viva (índice parcial WHERE deletedAt IS NULL).
CREATE UNIQUE INDEX IF NOT EXISTS "promociones_nombre_unico" ON "promociones"("nombre") WHERE "deletedAt" IS NULL;

-- ─── Cita.promocionId ─────────────────────────────────────────────────────────
ALTER TABLE "citas" ADD COLUMN "promocionId" UUID;
CREATE INDEX "citas_promocionId_idx" ON "citas"("promocionId");

-- FK en RESTRICT: la BD impide hard-delete de una Promocion con citas, forzando el camino
-- soft-delete (coherente con la arquitectura). Preserva la referencia histórica para Analytics.
ALTER TABLE "citas" ADD CONSTRAINT "citas_promocionId_fkey" FOREIGN KEY ("promocionId") REFERENCES "promociones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
