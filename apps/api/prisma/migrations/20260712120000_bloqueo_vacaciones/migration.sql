-- Vacaciones planificadas: bandera aditiva sobre bloqueos_agenda.
-- Un bloqueo de vacaciones es un PERMISO (esRecurrente=false) de día completo por cada día
-- del rango, marcado con esta bandera para pintarse como franja "Vacaciones" en la agenda.
-- Aditiva y no destructiva: columna nueva con DEFAULT constante (operación instantánea en PG,
-- sin reescritura de tabla) e invisible para el código previo. NO toca índices ni datos.
ALTER TABLE "bloqueos_agenda" ADD COLUMN "esVacaciones" BOOLEAN NOT NULL DEFAULT false;
