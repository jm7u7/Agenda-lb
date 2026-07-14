-- Marca ESTRUCTURAL de las asignaciones de "retorno automático" (las que devuelven a la
-- podóloga a su sede matriz al terminar un movimiento temporal). Hasta ahora se detectaban
-- por heurística (sede + fecha), lo que podía confundir un movimiento real con un retorno.
-- Aditiva: columna con default + backfill de las existentes por su nota canónica.
ALTER TABLE "asignaciones_sede" ADD COLUMN "esRetorno" BOOLEAN NOT NULL DEFAULT false;
UPDATE "asignaciones_sede" SET "esRetorno" = true WHERE notas LIKE 'Retorno automático%';
