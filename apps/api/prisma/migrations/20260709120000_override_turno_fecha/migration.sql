-- Override de turno por fecha: EntradaPodologa pasa de "solo entrada 8/9" a
-- "override completo del turno de un día" (entrada + salida opcional).
-- Aditiva: columna nueva opcional, cero impacto en filas existentes.
ALTER TABLE "entradas_podologa" ADD COLUMN "horaFin" TEXT;
