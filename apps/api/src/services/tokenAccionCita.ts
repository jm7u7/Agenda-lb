import { randomBytes } from 'crypto';
import { prisma } from '../db';

export type AccionCita = 'confirmar' | 'reprogramar';

/** Genera y persiste un token de acción de un solo uso para una cita. */
export async function crearTokenAccion(citaId: string, accion: AccionCita, expiraEn: Date): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await prisma.tokenAccionCita.create({
    data: { token, citaId, accion, expiraEn },
  });
  return token;
}

export interface ResultadoToken {
  ok: boolean;
  citaId?: string;
  motivo?: 'no_encontrado' | 'accion_invalida' | 'expirado' | 'ya_usado';
  yaUsado?: boolean;
}

/**
 * Valida y (opcionalmente) consume un token de acción.
 * - `confirmar` es single-use estricto: si ya fue usado, se rechaza.
 * - `reprogramar` registra el primer uso pero NO se rechaza si se reusa (el
 *   paciente puede volver a abrir WhatsApp); `yaUsado` lo indica.
 */
export async function consumirTokenAccion(token: string, accionEsperada: AccionCita): Promise<ResultadoToken> {
  const t = await prisma.tokenAccionCita.findUnique({ where: { token } });
  if (!t || t.deletedAt) return { ok: false, motivo: 'no_encontrado' };
  if (t.accion !== accionEsperada) return { ok: false, motivo: 'accion_invalida' };
  if (t.expiraEn.getTime() < Date.now()) return { ok: false, motivo: 'expirado' };

  const yaUsado = t.usadoAt != null;

  if (accionEsperada === 'confirmar' && yaUsado) {
    return { ok: false, motivo: 'ya_usado', citaId: t.citaId };
  }

  // Marca el primer uso (idempotente: no sobrescribe el primer usadoAt).
  if (!yaUsado) {
    await prisma.tokenAccionCita.update({ where: { token }, data: { usadoAt: new Date() } });
  }

  return { ok: true, citaId: t.citaId, yaUsado };
}
