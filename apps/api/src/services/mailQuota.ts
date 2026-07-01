import { redis } from '../redis';

/**
 * Guarda de cuota diaria de envío de Gmail. La cuenta consumer tiene ~500
 * destinatarios/día; mantenemos un margen configurable. Cuando se alcanza el
 * tope, los envíos se DIFIEREN al día siguiente (no se pierden ni fallan).
 */
export const LIMITE_DIARIO = Number(process.env.MAIL_LIMITE_DIARIO) || 450;

export class QuotaExcedidaError extends Error {
  constructor() { super('Cuota diaria de correo alcanzada'); this.name = 'QuotaExcedidaError'; }
}

// Fecha YYYY-MM-DD en America/Lima (UTC-5).
function fechaLima(d = new Date()): string {
  return new Date(d.getTime() - 5 * 3600_000).toISOString().slice(0, 10);
}

function claveCuota(): string {
  return `mail:cuota:${fechaLima()}`;
}

/**
 * Reserva un cupo de envío del día. Devuelve true si hay cupo (y lo consume),
 * false si ya se alcanzó el límite. Atómico vía INCR.
 */
export async function reservarCupoEnvio(): Promise<boolean> {
  const key = claveCuota();
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, 36 * 3600); // TTL > 1 día
  if (n > LIMITE_DIARIO) {
    await redis.decr(key); // devolver el cupo no usado
    return false;
  }
  return true;
}

/** Lanza QuotaExcedidaError si no hay cupo disponible (y reserva uno si lo hay). */
export async function asegurarCupoEnvio(): Promise<void> {
  if (!(await reservarCupoEnvio())) throw new QuotaExcedidaError();
}

/** Envíos consumidos hoy (para el panel / diagnóstico). */
export async function enviosHoy(): Promise<number> {
  const v = await redis.get(claveCuota());
  return v ? parseInt(v, 10) : 0;
}

/**
 * Próxima ventana de envío cuando se difiere por cuota: mañana 08:00 hora Lima
 * (= 13:00 UTC), cuando el contador del día ya se reinició.
 */
export function proximaVentanaEnvio(ahora = new Date()): Date {
  const limaMid = new Date(ahora.getTime() - 5 * 3600_000);
  limaMid.setUTCHours(0, 0, 0, 0);
  // mañana 08:00 Lima → +1 día +8h, y de Lima a UTC +5h
  return new Date(limaMid.getTime() + 24 * 3600_000 + 8 * 3600_000 + 5 * 3600_000);
}
