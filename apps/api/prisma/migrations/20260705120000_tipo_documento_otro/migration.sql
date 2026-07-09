-- Import Genexis: documentos no estándar del sistema antiguo ("OTRO", "SIN INFORMACIÓN" → OTRO).
-- Additive-only: agregar un valor a un enum no toca datos ni columnas existentes.
ALTER TYPE "TipoDocumento" ADD VALUE 'OTRO';
