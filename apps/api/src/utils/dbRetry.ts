/**
 * withDeadlockRetry — reintenta una operación de BD ante un deadlock o conflicto de
 * escritura TRANSITORIO de PostgreSQL, con backoff exponencial + jitter.
 *
 * Motivación: bajo alta concurrencia, dos INSERT de `citas` que referencian filas
 * padre compartidas (FK `FOR KEY SHARE` sobre profesional/sede/servicio/promoción…)
 * pueden adquirir esos locks en orden cruzado y provocar un deadlock (Postgres 40P01,
 * que Prisma reporta como P2034). No es un conflicto de negocio: al reintentar, ya sin
 * contención, la operación gana o choca limpiamente con el índice único (P2002 → 409).
 *
 * REGLA DURA: solo reintenta errores TRANSITORIOS de infraestructura (deadlock /
 * write-conflict). NUNCA reintenta un error de negocio (AppError: slot ocupado, horario
 * inválido, sin sesiones…) ni un P2002 (unicidad = decisión final, no transitorio) — esos
 * deben propagarse inmediatamente en el primer intento, sin latencia extra.
 */
import { Prisma } from '@prisma/client';

/** ¿El error es un deadlock / write-conflict transitorio que vale la pena reintentar? */
export function esDeadlockTransitorio(err: unknown): boolean {
  // Prisma: P2034 = "Transaction failed due to a write conflict or a deadlock".
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') return true;
  // Red de seguridad: algunos drivers surfacean el SQLSTATE crudo de Postgres.
  //   40P01 = deadlock_detected · 40001 = serialization_failure
  const msg = (err as { message?: string })?.message ?? '';
  const code = (err as { code?: string })?.code ?? '';
  return code === '40P01' || code === '40001' || /deadlock detected|could not serialize/i.test(msg);
}

/**
 * ¿El error de una escritura de cita debe convertirse en un 409 "slot ocupado"?
 * Cubre las DOS caras del conflicto de slot:
 *   - P2002: violación del índice único parcial (unicidad = decisión final del anti-doble-booking).
 *   - Deadlock que agotó los reintentos de `withDeadlockRetry`: P2034 (cuando Prisma lo clasifica)
 *     O el SQLSTATE 40P01/40001 CRUDO que Prisma re-lanza como `PrismaClientUnknownRequestError` /
 *     `ConnectorError` y NO reconoce como `KnownRequestError`. Este último es el caso que —sin este
 *     helper— caía al `throw err` del catch y devolvía un 500 en vez de un 409 (ver Gate 0).
 * Un AppError de negocio (horario inválido, sin sesiones…) o cualquier otro error devuelve `false`
 * y se propaga intacto: NUNCA se disfraza de SLOT_OCUPADO.
 */
export function esConflictoDeSlot(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return true;
  return esDeadlockTransitorio(err);
}

export interface DeadlockRetryOpts {
  maxIntentos?: number;      // total de intentos (incluye el primero). Default 3.
  basesMs?: number[];        // backoff base por reintento. Default [50, 150, 400].
  jitter?: number;           // ±fracción aleatoria del backoff. Default 0.2 (±20%).
  onRetry?: (info: { intento: number; esperaMs: number; err: unknown }) => void;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ejecuta `fn` y, si lanza un deadlock/write-conflict transitorio, reintenta con
 * backoff + jitter. Cualquier otro error (negocio, unicidad, etc.) se propaga tal cual,
 * de inmediato. Si se agotan los intentos, se relanza el último error transitorio (que
 * el llamador debe mapear a un 409 limpio, nunca 500).
 */
export async function withDeadlockRetry<T>(fn: () => Promise<T>, opts: DeadlockRetryOpts = {}): Promise<T> {
  const maxIntentos = opts.maxIntentos ?? 3;
  const bases = opts.basesMs ?? [50, 150, 400];
  const jitter = opts.jitter ?? 0.2;

  let ultimoErr: unknown;
  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      return await fn();
    } catch (err) {
      if (!esDeadlockTransitorio(err) || intento >= maxIntentos) throw err;
      ultimoErr = err;
      const base = bases[Math.min(intento - 1, bases.length - 1)]!;
      // jitter aleatorio ±`jitter` para desincronizar reintentos de transacciones que
      // colisionaron en el mismo instante (si todas esperan lo mismo, vuelven a chocar).
      const espera = Math.round(base * (1 + (Math.random() * 2 - 1) * jitter));
      opts.onRetry?.({ intento, esperaMs: espera, err });
      await dormir(espera);
    }
  }
  // Inalcanzable (el bucle o retorna o relanza), pero satisface el tipo.
  throw ultimoErr;
}
