import { api } from './client';

export interface KpisResponse {
  periodo: { desde: string; hasta: string };
  totalCitas: number;
  completadas: number;
  noShow: number;
  canceladas: number;
  llegaron: number;
  minutosAtendidos: number;
  horasAtendidas: number;
  tasaCompletadas: number;
  tasaNoShow: number;
  tasaCanceladas: number;
  tasaPropios: number;
  variacionTotal: number | null;
  variacionCompletadas: number | null;
  variacionNoShow: number | null;
  prevPeriodo: { desde: string; hasta: string };
}

export interface ProfesionalRow {
  profesionalId: string;
  nombres: string;
  apellidos: string;
  colorAvatar: string;
  totalCitas: number;
  completadas: number;
  noShow: number;
  canceladas: number;
  minutosAtendidos: number;
  tasaCompletadas: number;
  tasaNoShow: number;
  tasaPropios: number;
}

export interface ServicioRow {
  servicioId: string;
  nombre: string;
  color: string;
  unidadNegocio: string;
  totalCitas: number;
  completadas: number;
  noShow: number;
  minutosAtendidos: number;
  tasaCompletadas: number;
}

export interface SedeRow {
  sedeId: string;
  nombre: string;
  color: string;
  totalCitas: number;
  completadas: number;
  noShow: number;
  canceladas: number;
  minutosAtendidos: number;
  tasaCompletadas: number;
  tasaNoShow: number;
  tasaPropios: number;
}

export interface HeatmapCell {
  dia: number;
  hora: number;
  total: number;
  completadas: number;
}

export interface TendenciaPunto {
  fecha: string;
  totalCitas: number;
  completadas: number;
  noShow: number;
  canceladas: number;
}

export interface TendenciaResponse {
  granularidad: 'dia' | 'semana' | 'mes';
  puntos: TendenciaPunto[];
}

export interface NoShowResponse {
  porProfesional: {
    profesionalId: string | null;
    nombres: string;
    apellidos: string;
    total: number;
    noShow: number;
    canceladas: number;
    tasaNoShow: number;
  }[];
  porSede: {
    sedeId: string;
    nombre: string;
    color: string;
    total: number;
    noShow: number;
    canceladas: number;
    tasaNoShow: number;
  }[];
}

export interface CaseloadRow {
  profesionalId: string;
  nombres: string;
  apellidos: string;
  colorAvatar: string;
  totalCitas: number;
  propios: number;
  asignados: number;
  pctPropios: number;
}

export interface UnidadNegocioRow {
  id: string;
  nombre: string;
  color: string;
}

export interface CanalRow {
  canal: string;
  totalCitas: number;
  completadas: number;
  porcentaje: number;
}

export interface PromocionRow {
  promocionId: string;
  nombre: string;
  tipo: 'PRECIO_FIJO' | 'PORCENTAJE' | 'OTRO';
  valor: number | null;
  totalCitas: number;
  completadas: number;
  porcentajeCompletadas: number;
}

export interface PacientesNuevosResponse {
  periodo: { desde: string; hasta: string };
  prevPeriodo: { desde: string; hasta: string };
  total: number;
  prevTotal: number;
  variacion: number | null;
  puntos: { mes: string; nuevos: number }[];
  porSede: { sede: string; nuevos: number }[];
}

type FilterParams = {
  desde: string;
  hasta: string;
  sedeId?: string;
  unidadNegocioId?: string;
  profesionalId?: string;
  servicioId?: string;
};

function toQuery(p: FilterParams): Record<string, string> {
  const q: Record<string, string> = { desde: p.desde, hasta: p.hasta };
  if (p.sedeId) q.sedeId = p.sedeId;
  if (p.unidadNegocioId) q.unidadNegocioId = p.unidadNegocioId;
  if (p.profesionalId) q.profesionalId = p.profesionalId;
  if (p.servicioId) q.servicioId = p.servicioId;
  return q;
}

export const analyticsApi = {
  unidades: () => api.get<UnidadNegocioRow[]>('/analytics/unidades'),
  kpis: (p: FilterParams) => api.get<KpisResponse>('/analytics/kpis', toQuery(p)),
  profesionales: (p: FilterParams) => api.get<ProfesionalRow[]>('/analytics/profesionales', toQuery(p)),
  servicios: (p: FilterParams) => api.get<ServicioRow[]>('/analytics/servicios', toQuery(p)),
  sedes: (p: FilterParams) => api.get<SedeRow[]>('/analytics/sedes', toQuery(p)),
  heatmap: (p: FilterParams) => api.get<HeatmapCell[]>('/analytics/heatmap', toQuery(p)),
  tendencia: (p: FilterParams & { granularidad?: 'auto' | 'dia' | 'semana' | 'mes' }) =>
    api.get<TendenciaResponse>('/analytics/tendencia', {
      ...toQuery(p),
      ...(p.granularidad ? { granularidad: p.granularidad } : {}),
    }),
  noshow: (p: FilterParams) => api.get<NoShowResponse>('/analytics/noshow', toQuery(p)),
  caseload: (p: FilterParams) => api.get<CaseloadRow[]>('/analytics/caseload', toQuery(p)),
  pacientesNuevos: (p: FilterParams) => api.get<PacientesNuevosResponse>('/analytics/pacientes-nuevos', toQuery(p)),
  canales: (p: FilterParams) => api.get<CanalRow[]>('/analytics/canales', toQuery(p)),
  promociones: (p: FilterParams) => api.get<PromocionRow[]>('/analytics/promociones', toQuery(p)),
  recalcularHoy: () => api.post<{ ok: boolean; grupos: number }>('/analytics/recalcular/hoy', {}),
};
