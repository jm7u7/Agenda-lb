import { Worker } from 'bullmq';
import { QUEUE_NAME, JOB_ENVIAR, JOB_RESERVA, RECORDATORIOS_ACTIVOS, crearConexionBull } from './recordatorioQueue';
import { procesarEnvioRecordatorio, procesarEnvioReserva } from '../services/recordatorioService';

let worker: Worker | null = null;

/** Inicia el worker en proceso. No-op si los recordatorios están desactivados. */
export function iniciarRecordatorioWorker(): void {
  if (!RECORDATORIOS_ACTIVOS || worker) return;

  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { citaId } = job.data as { citaId: string };
      if (job.name === JOB_RESERVA) return procesarEnvioReserva(citaId);
      if (job.name === JOB_ENVIAR) return procesarEnvioRecordatorio(citaId);
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

  console.log('🔔 Worker de recordatorios iniciado');
}

export async function detenerRecordatorioWorker(): Promise<void> {
  if (worker) { await worker.close(); worker = null; }
}
