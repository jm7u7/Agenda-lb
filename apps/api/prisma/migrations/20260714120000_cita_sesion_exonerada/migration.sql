-- Exoneración de sesión por cita: "no aplicar / no descontar" (ej. el médico decide no
-- aplicar el láser). Si esVacaciones marca días bloqueados, esto marca citas que NO deben
-- consumir su sesión aunque el paciente haya llegado. Semántica por-cita → en un combo
-- Profilaxis+Láser solo se exonera la mitad de Láser.
-- Aditiva y no destructiva: columnas nuevas con DEFAULT constante (operación instantánea
-- en PG, sin reescritura de tabla) e invisibles para el código previo. NO toca índices ni datos.
ALTER TABLE "citas" ADD COLUMN "sesionExonerada" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "citas" ADD COLUMN "sesionExoneradaMotivo" TEXT;
