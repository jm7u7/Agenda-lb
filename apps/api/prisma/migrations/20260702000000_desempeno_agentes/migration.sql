-- Desempeño de Agentes — migración 100% ADITIVA.
-- Generada con `prisma migrate diff --from-schema-datamodel <viejo> --to-schema-datamodel <nuevo> --script`
-- (no toca los índices únicos parciales del baseline). Sin DROP de ningún tipo.

-- CreateEnum
CREATE TYPE "AreaAgente" AS ENUM ('CONTACT_CENTER', 'RECEPCION', 'OTRO');

-- AlterTable (columnas nuevas, nullable — no reescriben la tabla)
ALTER TABLE "usuarios" ADD COLUMN     "area" "AreaAgente",
ADD COLUMN     "sedeAsignadaId" UUID;

-- CreateIndex (aditivo; acelera KPIs por autor de la reserva en rango de fechas)
CREATE INDEX "citas_creadoPorUsuarioId_fecha_idx" ON "citas"("creadoPorUsuarioId", "fecha");

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_sedeAsignadaId_fkey" FOREIGN KEY ("sedeAsignadaId") REFERENCES "sedes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Permiso aditivo `analytics.agentes` para los roles de supervisión existentes.
-- Idempotente: solo agrega si el rol aún no lo tiene. No toca otros roles.
UPDATE "roles"
SET "permisos" = array_append("permisos", 'analytics.agentes')
WHERE "nombre" IN ('admin', 'coordinadora_sedes')
  AND NOT ("permisos" @> ARRAY['analytics.agentes']);
