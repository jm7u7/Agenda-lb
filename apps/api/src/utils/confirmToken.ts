import jwt from 'jsonwebtoken';

/**
 * Tokens firmados para los enlaces de "Confirmar" / "Cancelar" cita del correo.
 *
 * - Se firman con CONFIRM_TOKEN_SECRET (independiente del JWT_SECRET de sesión).
 * - Contienen el id de la cita y un `tipo` que evita reutilizar tokens de sesión.
 * - Tienen expiración (CONFIRM_TOKEN_EXPIRES_IN, por defecto 30 días).
 * - El mismo token sirve para confirmar y para cancelar: la acción la decide el
 *   endpoint (`/confirmar` vs `/cancelar`), no el token. Así un solo enlace por
 *   cita cubre ambos botones del correo.
 */

const TIPO_TOKEN = 'cita-confirmacion';

// Si no hay secreto definido, usamos uno de desarrollo (y avisamos). En producción
// CONFIRM_TOKEN_SECRET es obligatorio — ver README.
const SECRET = process.env.CONFIRM_TOKEN_SECRET;
if (!SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('CONFIRM_TOKEN_SECRET es obligatorio en producción');
  }
  console.warn('⚠️  CONFIRM_TOKEN_SECRET no definido — usando secreto de desarrollo. NO usar en producción.');
}
const SECRET_VALUE = SECRET || 'limablue-confirm-dev-secret-only';

const EXPIRES_IN = (process.env.CONFIRM_TOKEN_EXPIRES_IN || '30d') as import('jsonwebtoken').SignOptions['expiresIn'];

export interface ConfirmTokenPayload {
  citaId: string;
  tipo: typeof TIPO_TOKEN;
}

/** Firma un token para los enlaces de confirmación/cancelación de una cita. */
export function firmarTokenConfirmacion(citaId: string): string {
  return jwt.sign({ citaId, tipo: TIPO_TOKEN }, SECRET_VALUE, { expiresIn: EXPIRES_IN });
}

/**
 * Verifica un token y devuelve el id de la cita.
 * Lanza si el token es inválido, expiró o no es del tipo correcto.
 */
export function verificarTokenConfirmacion(token: string): { citaId: string } {
  const payload = jwt.verify(token, SECRET_VALUE) as ConfirmTokenPayload;
  if (payload.tipo !== TIPO_TOKEN || !payload.citaId) {
    throw new Error('Token de confirmación inválido');
  }
  return { citaId: payload.citaId };
}
