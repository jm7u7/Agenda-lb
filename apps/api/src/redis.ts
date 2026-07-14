import { Redis } from 'ioredis';

export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 100, 3000),
});

redis.on('error', (err) => {
  if (process.env.NODE_ENV !== 'test') {
    console.error('Redis error:', err.message);
  }
});

// ─── Helpers de lock (anti doble-booking) ─────────────────────────────────────

const LOCK_TTL = 30; // segundos

export function slotLockKey(sedeId: string, profesionalId: string, fecha: string, hora: string): string {
  return `lock:slot:${sedeId}:${profesionalId}:${fecha}:${hora}`;
}

export async function acquireSlotLock(
  sedeId: string,
  profesionalId: string,
  fecha: string,
  hora: string,
  requestId: string
): Promise<boolean> {
  const key = slotLockKey(sedeId, profesionalId, fecha, hora);
  const result = await redis.set(key, requestId, 'EX', LOCK_TTL, 'NX');
  return result === 'OK';
}

export async function releaseSlotLock(
  sedeId: string,
  profesionalId: string,
  fecha: string,
  hora: string,
  requestId: string
): Promise<void> {
  const key = slotLockKey(sedeId, profesionalId, fecha, hora);
  const current = await redis.get(key);
  if (current === requestId) {
    await redis.del(key);
  }
}

// ─── Cache de disponibilidad ──────────────────────────────────────────────────

export function disponibilidadCacheKey(sedeId: string, fecha: string, unidadId: string): string {
  return `cache:disponibilidad:${sedeId}:${unidadId}:${fecha}`;
}

export async function invalidateDisponibilidadCache(sedeId: string, fecha: string): Promise<void> {
  const pattern = `cache:disponibilidad:${sedeId}:*:${fecha}`;
  const keys = await redis.keys(pattern);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

/** Invalida TODAS las fechas de UNA sede (cambios que afectan muchas fechas de esa sede). */
export async function invalidateDisponibilidadSede(sedeId: string): Promise<void> {
  const keys = await redis.keys(`cache:disponibilidad:${sedeId}:*`);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

/** Invalida una FECHA en TODAS las sedes (para cambios sin sede conocida, ej. override de turno). */
export async function invalidateDisponibilidadFecha(fecha: string): Promise<void> {
  const keys = await redis.keys(`cache:disponibilidad:*:*:${fecha}`);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

/** Vacía TODA la caché de disponibilidad (cambios que afectan muchas fechas, ej. horario semanal). */
export async function flushDisponibilidadCache(): Promise<void> {
  const keys = await redis.keys('cache:disponibilidad:*');
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}
