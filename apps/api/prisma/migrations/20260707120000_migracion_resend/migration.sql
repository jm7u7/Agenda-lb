-- CAPA 2 · Migración a Resend — 100% ADITIVA.
-- Solo ADD COLUMN + ALTER … SET DEFAULT + UPDATE de datos.
-- SIN DROP, SIN ALTER destructivo. No toca los índices únicos parciales ni las
-- columnas de tokens OAuth de Gmail (deprecadas, se conservan con su valor).

-- AlterTable: correo de notificación de agenda por profesional (canal correo + .ics).
ALTER TABLE "profesionales" ADD COLUMN     "emailAgenda" TEXT;

-- AlterTable: marca soft de correo rebotado/quejado (excluir de futuros envíos, sin borrar el email).
ALTER TABLE "pacientes" ADD COLUMN     "emailInvalido" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: el proveedor por defecto de filas NUEVAS pasa a Resend.
ALTER TABLE "mail_config" ALTER COLUMN "provider" SET DEFAULT 'resend';

-- AlterTable: id del correo devuelto por Resend (transporte actual).
ALTER TABLE "recordatorios_cita" ADD COLUMN     "resendEmailId" TEXT;

-- Data: la(s) fila(s) de configuración existentes pasan a 'resend'. SOLO toca la
-- columna provider; NO modifica refreshToken / fromEmail / fromName (tokens OAuth intactos).
UPDATE "mail_config" SET "provider" = 'resend' WHERE "provider" <> 'resend';

-- Data: Yasica Doy recibe sus invitaciones .ics en su cuenta Microsoft 365
-- (yasicadoy@limablue.com), ya NO en Gmail. Targeting por NOMBRE (no por id) para
-- que funcione igual en dev y en producción. NO modifica a los demás profesionales:
-- Daniel Doy se sincroniza por Graph y queda con emailAgenda = NULL.
UPDATE "profesionales"
SET "emailAgenda" = 'yasicadoy@limablue.com'
WHERE lower("nombres") LIKE '%yasica%' AND lower("apellidos") LIKE '%doy%';
