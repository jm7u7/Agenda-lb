-- Bloques combinados: Profilaxis (ancla) + servicio extra en el mismo slot de 1 h.
-- Dos citas reales que comparten `slotGrupoId`; `slotRol` distingue ancla/extra.

-- ─── Enum SlotRol ─────────────────────────────────────────────────────────────
CREATE TYPE "SlotRol" AS ENUM ('PRINCIPAL', 'SECUNDARIO');

-- ─── Columnas nuevas en citas ─────────────────────────────────────────────────
ALTER TABLE "citas" ADD COLUMN "slotGrupoId" UUID;
ALTER TABLE "citas" ADD COLUMN "slotRol" "SlotRol";

-- CreateIndex
CREATE INDEX "citas_slotGrupoId_idx" ON "citas"("slotGrupoId");

-- ─── CombinacionPermitida ─────────────────────────────────────────────────────
CREATE TABLE "combinaciones_permitidas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "servicioExtraId" UUID NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "combinaciones_permitidas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "combinaciones_permitidas_servicioExtraId_idx" ON "combinaciones_permitidas"("servicioExtraId");

-- AddForeignKey
ALTER TABLE "combinaciones_permitidas" ADD CONSTRAINT "combinaciones_permitidas_servicioExtraId_fkey" FOREIGN KEY ("servicioExtraId") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── ConfiguracionSistema (fila única) ────────────────────────────────────────
CREATE TABLE "configuracion_sistema" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "servicioAnclaId" UUID,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracion_sistema_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "configuracion_sistema" ADD CONSTRAINT "configuracion_sistema_servicioAnclaId_fkey" FOREIGN KEY ("servicioAnclaId") REFERENCES "servicios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Índices únicos PARCIALES (la última línea de defensa anti-doble-booking).
-- ─────────────────────────────────────────────────────────────────────────────

-- Un solo registro ACTIVO de combinación por servicio extra.
CREATE UNIQUE INDEX IF NOT EXISTS "combinaciones_servicio_unico"
  ON "combinaciones_permitidas" ("servicioExtraId")
  WHERE "deletedAt" IS NULL;

-- Anti-doble-booking con soporte de bloques combinados. Se REEMPLAZA el índice
-- único `citas_slot_activo_unique` (que cubría 1 cita por profesional/slot) por DOS
-- índices parciales complementarios:
--
--  • citas_slot_primario_unique  : ocupante PRIMARIO = cita suelta (slotRol NULL) O
--    el ancla de un bloque (PRINCIPAL). Máx 1 por (profesional, fecha, hora). Así una
--    suelta y un ancla del mismo profesional/slot CHOCAN (sin hueco), y dos bloques
--    distintos anclados en el mismo profesional/slot también chocan (ambos PRINCIPAL).
--  • citas_slot_secundario_unique: ocupante SECUNDARIO = el extra de un bloque. Máx 1
--    por (profesional, fecha, hora).
--
-- Resultado: como mucho 1 primario + 1 secundario = exactamente 2 citas por
-- profesional/slot (el bloque combinado de la misma profesional), nunca 3.
DROP INDEX IF EXISTS "citas_slot_activo_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "citas_slot_primario_unique"
  ON "citas" ("profesionalId", "fecha", "horaInicio")
  WHERE "deletedAt" IS NULL
    AND estado NOT IN ('cancelada','no_show','reprogramada')
    AND ("slotRol" IS NULL OR "slotRol" = 'PRINCIPAL');

CREATE UNIQUE INDEX IF NOT EXISTS "citas_slot_secundario_unique"
  ON "citas" ("profesionalId", "fecha", "horaInicio")
  WHERE "deletedAt" IS NULL
    AND estado NOT IN ('cancelada','no_show','reprogramada')
    AND "slotRol" = 'SECUNDARIO';
