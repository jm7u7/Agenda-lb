-- CreateTable
CREATE TABLE "comentarios_cita" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "citaId" UUID NOT NULL,
    "autorId" UUID,
    "autorEtiqueta" TEXT,
    "texto" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "comentarios_cita_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comentarios_cita_citaId_creadoEn_idx" ON "comentarios_cita"("citaId", "creadoEn");

-- AddForeignKey
ALTER TABLE "comentarios_cita" ADD CONSTRAINT "comentarios_cita_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comentarios_cita" ADD CONSTRAINT "comentarios_cita_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

