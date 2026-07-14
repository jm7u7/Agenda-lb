import { Worker } from 'bullmq';
import { QUEUE_NAME, JOB_ENVIAR, JOB_RESERVA, RECORDATORIOS_ACTIVOS, crearConexionBull } from './recordatorioQueue';
import { procesarEnvioRecordatorio, procesarEnvioReserva } from '../services/recordatorioService';

// Marca de versión del worker. Aparece en el log de arranque → sirve para confirmar,
// tras un deploy, que el proceso vivo corre este código (el que distingue cupo
// auto/manual en el envío de recordatorios — fix B-1). Súbela al cambiar el worker.
export const WORKER_VERSION = 'b1-tipo-aware-2026-07-11';

let worker: Worker | null = null;

/** Inicia el worker en proceso. No-op si los recordatorios están desactivados. */
export function iniciarRecordatorioWorker(): void {
  if (!RECORDATORIOS_ACTIVOS || worker) return;

  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { citaId, tipo } = job.data as { citaId: string; tipo?: 'auto' | 'manual' };
      if (job.name === JOB_RESERVA) return procesarEnvioReserva(citaId);
      if (job.name === JOB_ENVIAR) {
        const cupo = tipo ?? 'auto';
        // Log del cupo LEÍDO de job.data.tipo: evidencia de que este worker respeta
        // la sub-cuota manual (B-1). Un reenvío manual debe registrar cupo=manual.
        console.log(`[worker] enviar recordatorio cita ${citaId} · cupo=${cupo}`);
        return procesarEnvioRecordatorio(citaId, cupo);
      }
      return 'omitido';
    },
    // Concurrencia baja para respetar el rate-limit de envío de Gmail.
    { connection: crearConexionBull(), concurrency: 2 },
  );

  worker.on('completed', (job, result) => {
    console.log(`[worker] recordatorio cita ${job.data?.citaId}: ${result}`);
  });
  worker.on('failed', (job, err) => {
    console.warn(`[worker] recordatorio cita ${job?.data?.citaId} falló (intento ${job?.attemptsMade}):`, err.message);
  });

  console.log(`🔔 Worker de recordatorios iniciado — cupo auto/manual [B-1] · v=${WORKER_VERSION}`);
}

export async function detenerRecordatorioWorker(): Promise<void> {
  if (worker) { await worker.close(); worker = null; }
}
