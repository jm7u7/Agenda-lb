import { Queue, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';

// El worker/cola se puede apagar con RECORDATORIOS_ACTIVOS="false".
export const RECORDATORIOS_ACTIVOS = process.env.RECORDATORIOS_ACTIVOS !== 'false';
export const QUEUE_NAME = 'recordatorios-cita';
export const JOB_ENVIAR = 'enviar-recordatorio';
export const JOB_RESERVA = 'enviar-reserva';

// BullMQ exige una conexión con maxRetriesPerRequest = null (distinta de la de
// locks/cache). Se crea una conexión dedicada y reutilizable.
export function crearConexionBull(): ConnectionOptions {
  return new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  }) as unknown as ConnectionOptions;
}

let queue: Queue | null = null;

export function getRecordatorioQueue(): Queue | null {
  if (!RECORDATORIOS_ACTIVOS) return null;
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: crearConexionBull() });
  }
  return queue;
}

// jobId fijo por cita → idempotencia: nunca hay dos jobs de recordatorio para la
// misma cita, por más veces que corra el scheduler.
export function jobIdDeCita(citaId: string): string {
  // BullMQ no permite ":" en el jobId personalizado.
  return `recordatorio-${citaId}`;
}

/**
 * Programa (o reprograma) el envío del recordatorio de una cita. Si ya existía
 * un job para esa cita, lo elimina y crea el nuevo con el delay correcto.
 * Devuelve el jobId o null si la cola está desactivada.
 */
export async function programarJobRecordatorio(citaId: string, programadoPara: Date): Promise<string | null> {
  const q = getRecordatorioQueue();
  if (!q) return null;

  const jobId = jobIdDeCita(citaId);
  const previo = await q.getJob(jobId);
  if (previo) await previo.remove();

  const delay = Math.max(0, programadoPara.getTime() - Date.now());
  await q.add(
    JOB_ENVIAR,
    { citaId },
    {
      jobId,
      delay,
      attempts: 3,                                   // reintentos automáticos…
      backoff: { type: 'exponential', delay: 60_000 }, // …con backoff 1m, 2m, 4m
      removeOnComplete: { age: 7 * 24 * 3600 },      // conserva 7 días para trazabilidad
      removeOnFail: false,                           // los fallidos se inspeccionan
    },
  );
  return jobId;
}

/** Encola el envío (o reintento diferido) del Correo 1 de reserva. */
export async function programarJobReserva(citaId: string, cuando: Date): Promise<string | null> {
  const q = getRecordatorioQueue();
  if (!q) return null;
  const jobId = `reserva-${citaId}`;
  const previo = await q.getJob(jobId);
  if (previo) await previo.remove();
  await q.add(
    JOB_RESERVA,
    { citaId },
    { jobId, delay: Math.max(0, cuando.getTime() - Date.now()), attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: { age: 7 * 24 * 3600 }, removeOnFail: false },
  );
  return jobId;
}

/** Cancela el job de recordatorio de una cita (si existe). */
export async function cancelarJobRecordatorio(citaId: string): Promise<void> {
  const q = getRecordatorioQueue();
  if (!q) return;
  const job = await q.getJob(jobIdDeCita(citaId));
  if (job) await job.remove();
}
