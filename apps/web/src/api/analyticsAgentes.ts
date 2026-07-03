import { api } from './client';

// ─── Tipos (espejo del backend agentPerformanceService) ───────────────────────
export type AreaAgente = 'CONTACT_CENTER' | 'RECEPCION' | 'OTRO';

/** null = SIN DATOS (denominador 0) — distinto de 0. La UI muestra "—". */
export type Tasa = number | null;

export interface SedeRef { id: string; nombre: string; color: string }

export interface AgenteKpis {
  agenteId: string;
  nombre: string;
  area: AreaAgente;
  sede: SedeRef | null;
  volumen: { agendamientos: number; citasIndividuales: number; diasActivos: number; porDiaActivo: Tasa };
  gestion: {
    reprogramaciones: number; reacomodos: number;
    sobreCitasPropias: number; sobreCitasAjenas: number;
    cancelacionesEjecutadas: number; confirmacionesGestionadas: number;
  };
  calidad: {
    vencidas: number; completadas: number; showRate: Tasa;
    noShows: number; noShowRate: Tasa;
    canceladasPropias: number; cancelacionPosteriorRate: Tasa;
    retrabajadas: number; retrabajoRate: Tasa;
    calidadDatos: Tasa; leadTimeDias: Tasa;
  };
  conversion: {
    bloquesCombinados: number; tasaBloquesCombinados: Tasa;
    conPromocion: number; tasaUsoPromociones: Tasa;
    pacientesNuevos: number; mixPacientesNuevos: Tasa;
    recitaciones: number; atencionesSedeBase: number; tasaRecitacion: Tasa;
  };
  semanas: { semana: string; agendamientos: number; vencidas: number; completadas: number }[];
  score: number | null;
  percentiles: { volumen: number | null; showRate: number | null };
  sinDatos: boolean;
}

export interface ResumenAgentes {
  agentes: AgenteKpis[];
  totales: {
    agendamientos: number; citasIndividuales: number; showRate: Tasa;
    reprogramaciones: number; reacomodos: number; cancelaciones: number;
    recitaciones: number; tasaRecitacion: Tasa;
  };
  variaciones: {
    agendamientos: number | null; showRate: number | null;
    reprogramaciones: number | null; cancelaciones: number | null; tasaRecitacion: number | null;
  } | null;
  tendenciaSemanal: { semana: string; agendamientos: number; showRate: Tasa }[];
  valorAsistido: { disponible: false; motivo: string };
  prevPeriodo: { desde: string; hasta: string };
}

export interface AgenteLista { id: string; nombre: string; area: AreaAgente; sedeAsignada: SedeRef | null }

export interface ComparativaAgentes { umbralShowRateCritico: number; agentes: AgenteKpis[] }

export interface DetalleAgente {
  agente: AgenteKpis;
  totalesEquipo: ResumenAgentes['totales'];
  porSede: { sede: SedeRef; citas: number }[];
  porServicio: { servicio: { id: string; nombre: string; color: string }; citas: number }[];
}

export interface CitasAgentePage {
  page: number; pageSize: number; total: number; totalPages: number;
  citas: {
    id: string; fecha: string; horaInicio: string; estado: string; canal: string;
    slotGrupoId: string | null; slotRol: 'PRINCIPAL' | 'SECUNDARIO' | null; creadoDia: string;
    paciente: { nombres: string; apellidoPaterno: string };
    sede: { nombre: string; color: string };
    servicio: { nombre: string; color: string };
    promocion: { nombre: string } | null;
  }[];
}

export interface TimelinePage {
  page: number; pageSize: number; total: number; totalPages: number;
  eventos: { id: string; accion: string; citaId: string | null; antes: unknown; despues: unknown; creadoEn: string }[];
}

export interface RecitacionReporte {
  porSede: { sede: SedeRef; atenciones: number; conRecita: number; sinProximaCita: number; tasa: Tasa }[];
  porRecepcionista: { agenteId: string; nombre: string; sede: SedeRef | null; recitaciones: number; atencionesSede: number; tasa: Tasa; sinDatos: boolean }[];
  brechaOportunidad: { disponible: false; motivo: string };
}

export interface AgentesParams {
  desde: string;
  hasta: string;
  sedeId?: string;
  area?: AreaAgente;
  servicioId?: string;
  canal?: string;
}

const qs = (p: AgentesParams): Record<string, string> => ({
  desde: p.desde, hasta: p.hasta,
  ...(p.sedeId ? { sedeId: p.sedeId } : {}),
  ...(p.area ? { area: p.area } : {}),
  ...(p.servicioId ? { servicioId: p.servicioId } : {}),
  ...(p.canal ? { canal: p.canal } : {}),
});

const BASE = '/analytics/agentes';

export const agentesApi = {
  lista: () => api.get<AgenteLista[]>(`${BASE}/lista`),
  resumen: (p: AgentesParams) => api.get<ResumenAgentes>(`${BASE}/resumen`, qs(p)),
  comparativa: (p: AgentesParams, ids: string[]) =>
    api.get<ComparativaAgentes>(`${BASE}/comparativa`, { ...qs(p), ids: ids.join(',') }),
  recitacion: (p: AgentesParams) => api.get<RecitacionReporte>(`${BASE}/recitacion`, qs(p)),
  agente: (id: string, p: AgentesParams) => api.get<DetalleAgente>(`${BASE}/agente/${id}`, qs(p)),
  agenteCitas: (id: string, p: AgentesParams, page: number) =>
    api.get<CitasAgentePage>(`${BASE}/agente/${id}/citas`, { ...qs(p), page: String(page) }),
  timeline: (id: string, page: number) =>
    api.get<TimelinePage>(`${BASE}/timeline/${id}`, { page: String(page) }),
};

// Etiquetas y colores de área (punto único para la UI)
export const AREA_LABEL: Record<AreaAgente, string> = {
  CONTACT_CENTER: 'Contact Center',
  RECEPCION: 'Recepción',
  OTRO: 'Otro',
};
export const AREA_COLOR: Record<AreaAgente, string> = {
  CONTACT_CENTER: '#8b5cf6', // violeta
  RECEPCION: '#0ea5e9',      // celeste
  OTRO: '#64748b',
};
