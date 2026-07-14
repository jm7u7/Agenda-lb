import { redis } from '../redis';

/**
 * Guarda de cuota diaria de envío de Gmail. La cuenta consumer tiene ~500
 * destinatarios/día; mantenemos un margen configurable. Cuando se alcanza el
 * tope, los envíos se DIFIEREN al día siguiente (no se pierden ni fallan).
 *
 * Dos tipos de envío comparten el MISMO contador diario, con topes distintos:
 *  - `auto`   → recordatorios automáticos en masa (worker BullMQ). Se detienen al
 *               llegar a `LIMITE_DIARIO - RESERVA_MANUAL`, dejando un colchón.
 *  - `manual` → reenvíos que dispara una persona de recepción (botón "Reenviar
 *               correo"). Pueden llegar hasta `LIMITE_DIARIO` (el tope real del
 *               proveedor). Así un envío manual urgente nunca queda bloqueado por
 *               los recordatorios automáticos del día (hallazgo B-1).
 */
export const LIMITE_DIARIO = Number(process.env.MAIL_LIMITE_DIARIO) || 450;

// Colchón de envíos que los automáticos NO pueden consumir: queda reservado para
// los reenvíos manuales de recepción. Acotado a [0, LIMITE_DIARIO-1] para que el
// tope automático nunca sea 0 ni negativo por una mala configuración.
export const RESERVA_MANUAL = Math.min(
  Math.max(Number(process.env.MAIL_RESERVA_MANUAL) || 50, 0),
  LIMITE_DIARIO - 1,
);

// Tope efectivo para los envíos automáticos (deja la reserva para los manuales).
export const LIMITE_AUTOMATICO = LIMITE_DIARIO - RESERVA_MANUAL;

export type TipoEnvio = 'auto' | 'manual';

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

function topePara(tipo: TipoEnvio): number {
  return tipo === 'manual' ? LIMITE_DIARIO : LIMITE_AUTOMATICO;
}

/**
 * Reserva un cupo de envío del día. Devuelve true si hay cupo (y lo consume),
 * false si ya se alcanzó el tope aplicable al tipo. Atómico vía INCR.
 * Los manuales pueden usar hasta LIMITE_DIARIO; los automáticos solo hasta
 * LIMITE_AUTOMATICO (dejando la reserva libre para los manuales).
 */
export async function reservarCupoEnvio(tipo: TipoEnvio = 'auto'): Promise<boolean> {
  const key = claveCuota();
  const tope = topePara(tipo);
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, 36 * 3600); // TTL > 1 día
  if (n > tope) {
    await redis.decr(key); // devolver el cupo no usado
    return false;
  }
  return true;
}

/** Lanza QuotaExcedidaError si no hay cupo disponible (y reserva uno si lo hay). */
export async function asegurarCupoEnvio(tipo: TipoEnvio = 'auto'): Promise<void> {
  if (!(await reservarCupoEnvio(tipo))) throw new QuotaExcedidaError();
}

/** Envíos consumidos hoy (para el panel / diagnóstico). */
export async function enviosHoy(): Promise<number> {
  const v = await redis.get(claveCuota());
  return v ? parseInt(v, 10) : 0;
}

/**
 * Estado de la cuota del día para el panel: cuánto se usó, el tope absoluto, la
 * reserva manual y cuánto queda para cada tipo de envío.
 */
export async function estadoCuota(): Promise<{
  usados: number;
  limiteDiario: number;
  reservaManual: number;
  limiteAutomatico: number;
  restanteAutomatico: number;
  restanteManual: number;
}> {
  const usados = await enviosHoy();
  return {
    usados,
    limiteDiario: LIMITE_DIARIO,
    reservaManual: RESERVA_MANUAL,
    limiteAutomatico: LIMITE_AUTOMATICO,
    restanteAutomatico: Math.max(LIMITE_AUTOMATICO - usados, 0),
    restanteManual: Math.max(LIMITE_DIARIO - usados, 0),
  };
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
