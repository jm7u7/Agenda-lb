-- Distrito de residencia del paciente (UBIGEO INEI) + país para extranjeros.
-- 100% ADITIVA: tabla nueva + 2 columnas nullable. Cero impacto en los 55K pacientes.
CREATE TABLE "ubigeos" (
  "id"           TEXT NOT NULL,
  "distrito"     TEXT NOT NULL,
  "provincia"    TEXT NOT NULL,
  "departamento" TEXT NOT NULL,
  "esLimaMetro"  BOOLEAN NOT NULL DEFAULT false,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  "deletedAt"    TIMESTAMP(3),
  CONSTRAINT "ubigeos_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "pacientes" ADD COLUMN "ubigeoId" TEXT;
ALTER TABLE "pacientes" ADD COLUMN "paisResidencia" TEXT;

ALTER TABLE "pacientes" ADD CONSTRAINT "pacientes_ubigeoId_fkey"
  FOREIGN KEY ("ubigeoId") REFERENCES "ubigeos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "pacientes_ubigeoId_idx" ON "pacientes"("ubigeoId");
