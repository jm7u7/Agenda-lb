import { api } from './client';

export interface RecordatorioDia {
  recordatorioId: string;
  citaId: string;
  estadoRecordatorio: 'PROGRAMADO' | 'ENVIADO' | 'FALLIDO' | 'CANCELADO';
  programadoPara: string;
  intentos: number;
  gmailMessageId: string | null;
  clickConfirmarAt: string | null;
  clickReprogramarAt: string | null;
  confirmadoAt: string | null;
  errorMensaje: string | null;
  fecha: string;
  hora: string;
  estadoCita: string;
  estadoConfirmacion: string;
  paciente: string;
  email: string | null;
  telefono: string;
  profesional: string | null;
  sede: string;
  servicio: string;
}

export interface RecordatorioMetricas {
  total: number;
  enviados: number;
  programados: number;
  fallidos: number;
  cancelados: number;
  confirmados: number;
  pidioReprogramar: number;
  conClic: number;
  sinRespuesta: number;
  tasaEnvioExitoso: number;
  tasaRespuesta: number;
  tasaConfirmacionEfectiva: number;
  pctConfirmados: number;
  pctPidioReprogramar: number;
  cuotaUsadaHoy: number;
  cuotaLimiteDiario: number;
  tiempoPromedioConfirmacionMin: number | null;
  porSede: { sede: string; enviados: number; confirmados: number; tasaConfirmacion: number }[];
  porDia: { fecha: string; enviados: number; confirmados: number }[];
}

export interface FiltroRecordatorios {
  fecha?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  sedeId?: string;
  profesionalId?: string;
  estado?: string;
}

function params(f: FiltroRecordatorios): Record<string, string> {
  const p: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) if (v) p[k] = v;
  return p;
}

export const recordatoriosApi = {
  dia: (f: FiltroRecordatorios) => api.get<RecordatorioDia[]>('/recordatorios/dia', params(f)),
  metricas: (f: FiltroRecordatorios) => api.get<RecordatorioMetricas>('/recordatorios/metricas', params(f)),
  reenviar: (citaId: string) => api.post<{ ok: boolean }>(`/recordatorios/${citaId}/reenviar`, {}),
};
