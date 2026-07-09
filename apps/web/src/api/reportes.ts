// Reportes RRHH — horas extra (fuera de horario, con recargo peruano) y rotación
// intersedes por mes (bonos). Solo lectura; el saldo/estado lo calcula el servidor.
import { api } from './client';

export interface DiaHoraExtra {
  fecha: string;
  sede: string;
  sedeColor: string;
  horas: number;
  equivalente: number;
  categoria: 'DESCANSO' | 'EXTENDIDO';
  entrada: string;
  salida: string;
  nota: string | null;
}
export interface FilaHoraExtra {
  profesionalId: string;
  nombre: string;
  tipo: string;
  colorAvatar: string;
  horasExtra: number;
  horasEquivalentes: number;
  diasDescanso: number;
  diasExtendido: number;
  dias: DiaHoraExtra[];
}
export interface ReporteHorasExtra {
  desde: string;
  hasta: string;
  totalHorasExtra: number;
  totalHorasEquivalentes: number;
  profesionales: FilaHoraExtra[];
}

export interface TimelineDia {
  fecha: string;
  sede: string | null;
  color: string | null;
  prestamo: boolean;
  trabaja: boolean;
}
export interface FilaRotacion {
  profesionalId: string;
  nombre: string;
  colorAvatar: string;
  sedeBaseId: string | null;
  sedeBase: string | null;
  totalDias: number;
  diasBase: number;
  diasPrestamo: number;
  metaDiasMes: number | null;
  metaEfectiva: number | null;
  cumpleMeta: boolean | null;
  pctCumplimiento: number | null;
  porSede: { sede: string; color: string; dias: number; prestamo: boolean }[];
  timeline: TimelineDia[];
}
export interface ReporteRotacion {
  desde: string;
  hasta: string;
  sedes: { id: string; nombre: string; color: string }[];
  profesionales: FilaRotacion[];
}

export const reportesApi = {
  horasExtra: (p: { desde: string; hasta: string; sedeId?: string }) =>
    api.get<ReporteHorasExtra>('/reportes/horas-extra', p as Record<string, string>),
  rotacion: (p: { desde: string; hasta: string; sedeId?: string; profesionalId?: string; meta?: number }) =>
    api.get<ReporteRotacion>('/reportes/rotacion', {
      desde: p.desde,
      hasta: p.hasta,
      ...(p.sedeId ? { sedeId: p.sedeId } : {}),
      ...(p.profesionalId ? { profesionalId: p.profesionalId } : {}),
      ...(p.meta != null ? { meta: String(p.meta) } : {}),
    } as Record<string, string>),
  fijarMeta: (profesionalId: string, metaDiasMes: number | null) =>
    api.patch<{ ok: boolean; metaDiasMes: number | null }>(`/reportes/meta/${profesionalId}`, { metaDiasMes }),
};
