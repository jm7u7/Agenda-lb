// Proceso worker independiente para los recordatorios de cita.
//   npm run worker
// Úsalo en producción/alta disponibilidad junto con RECORDATORIOS_WORKER_INLINE="false"
// en el proceso del API, para separar el envío de correo del tráfico HTTP.
import dotenv from 'dotenv';
dotenv.config();

// Mismo anclaje a UTC que el API (ver index.ts) — fechas idénticas en cualquier host.
process.env.TZ = 'UTC';

import { iniciarRecordatorioWorker, detenerRecordatorioWorker } from './queue/recordatorioWorker';
import { RECORDATORIOS_ACTIVOS } from './queue/recordatorioQueue';

if (!RECORDATORIOS_ACTIVOS) {
  console.log('⏸  RECORDATORIOS_ACTIVOS="false": el worker no se inicia.');
  process.exit(0);
}

console.log('🔧 Worker de recordatorios (proceso separado) iniciando…');
iniciarRecordatorioWorker();

async function apagar(): Promise<void> {
  console.log('🛑 Cerrando worker de recordatorios…');
  await detenerRecordatorioWorker();
  process.exit(0);
}
process.on('SIGTERM', apagar);
process.on('SIGINT', apagar);
