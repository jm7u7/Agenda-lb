-- Amplía las unidades de offset del módulo Videos por Servicio para permitir programar
-- envíos con rangos largos DESPUÉS de la cita (meses/años): recordatorios de aniversario
-- (ej. "1 mes desde tu última profilaxis", "1 año desde la fabricación de tus plantillas").
-- Migración PURAMENTE ADITIVA: solo agrega valores al enum; no toca nada existente.
ALTER TYPE "UnidadOffset" ADD VALUE IF NOT EXISTS 'MESES';
ALTER TYPE "UnidadOffset" ADD VALUE IF NOT EXISTS 'ANIOS';
