/**
 * Cola BullMQ del módulo Videos por Servicio: un job REPETIBLE cada 5 min que barre
 * los VideoEnvioLog vencidos y los envía (ver services/videoEnvioService.procesarBarridoVideos).
 *
 * Reutiliza la conexión Redis dedicada de BullMQ (misma que los recordatorios). Se puede
 * apagar con VIDEOS_SERVICIO_ACTIVOS="false".
 */
import { Queue, Worker } from 'bullmq';
import { crearConexionBull } from './recordatorioQueue';
import { procesarBarridoVideos } from '../services/videoEnvioService';

export const VIDEOS_SERVICIO_ACTIVOS = process.env.VIDEOS_SERVICIO_ACTIVOS !== 'false';
export const VIDEO_QUEUE_NAME = 'videos-servicio';
export const JOB_BARRIDO = 'barrido-videos';
const INTERVALO_MS = 5 * 60_000; // cada 5 minutos

let queue: Queue | null = null;
let worker: Worker | null = null;

function getVideoQueue(): Queue | null {
  if (!VIDEOS_SERVICIO_ACTIVOS) return null;
  if (!queue) queue = new Queue(VIDEO_QUEUE_NAME, { connection: crearConexionBull() });
  return queue;
}

/**
 * Registra (o re-registra) el job repetible cada 5 min. Limpia repeticiones previas
 * para no acumular schedulers duplicados entre reinicios. Idempotente.
 */
export async function programarBarridoVideos(): Promise<void> {
  const q = getVideoQueue();
  if (!q) return;
  // Elimina cualquier repeatable anterior de este job (evita duplicados al reiniciar).
  const repetibles = await q.getRepeatableJobs();
  for (const r of repetibles) {
    if (r.name === JOB_BARRIDO) await q.removeRepeatableByKey(r.key);
  }
  await q.add(
    JOB_BARRIDO,
    {},
    {
      repeat: { every: INTERVALO_MS },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
    },
  );
}

/** Inicia el worker del barrido en proceso. No-op si el módulo está desactivado. */
export function iniciarVideoWorker(): void {
  if (!VIDEOS_SERVICIO_ACTIVOS || worker) return;

  worker = new Worker(
    VIDEO_QUEUE_NAME,
    async () => {
      const stats = await procesarBarridoVideos();
      return stats;
    },
    // Concurrencia 1: un solo barrido a la vez (los envíos van en lotes pequeños dentro).
    { connection: crearConexionBull(), concurrency: 1 },
  );

  worker.on('completed', (_job, result) => {
    const r = result as { enviados: number; cancelados: number; errores: number; expirados: number } | undefined;
    if (r && (r.enviados || r.cancelados || r.errores || r.expirados)) {
      console.log(`[video-worker] barrido: ${r.enviados} enviados, ${r.cancelados} cancelados, ${r.errores} errores, ${r.expirados} expirados`);
    }
  });
  worker.on('failed', (_job, err) => {
    console.warn('[video-worker] barrido falló:', err.message);
  });

  console.log('🎬 Worker de videos por servicio iniciado (barrido cada 5 min)');
}

export async function detenerVideoWorker(): Promise<void> {
  if (worker) { await worker.close(); worker = null; }
}
