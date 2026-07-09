-- Módulo Sesiones: las membresías viven en el módulo Promociones como tipo propio.
-- Additive-only: agregar un valor a un enum no toca datos ni columnas existentes.
ALTER TYPE "TipoPromocion" ADD VALUE 'MEMBRESIA';
