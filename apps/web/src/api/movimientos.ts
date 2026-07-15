import { api } from './client';

export type MotivoMovimiento =
  | 'VACACIONES'
  | 'CAMBIO_POR_TIEMPO'
  | 'CERCANIA_A_CASA'
  | 'PROBLEMAS_INTERNOS'
  | 'COBERTURA_EMERGENCIA'
  | 'OTRO';

export const MOTIVO_LABELS: Record<MotivoMovimiento, string> = {
  VACACIONES: 'Vacaciones',
  CAMBIO_POR_TIEMPO: 'Cambio por tiempo',
  CERCANIA_A_CASA: 'Cercanía a casa',
  PROBLEMAS_INTERNOS: 'Problemas internos',
  COBERTURA_EMERGENCIA: 'Cobertura emergencia',
  OTRO: 'Otro',
};

export interface Movimiento {
  id: string;
  profesionalId: string;
  sedeId: string;
  fechaInicio: string;
  fechaFin: string | null;
  activa: boolean;
  esRetorno: boolean;
  motivo: MotivoMovimiento;
  motivoLabel: string;
  notas: string | null;
  reemplazaA: string | null;
  estadoCalc: 'activo' | 'proximo' | 'futuro' | 'historial';
  profesional: { id: string; nombres: string; apellidos: string; colorAvatar: string };
  sede: { id: string; nombre: string; color: string };
  reemplazaProfesional: { id: string; nombres: string; apellidos: string } | null;
  creadoPorUsuario: { id: string; nombre: string } | null;
}

export interface PreviewMovimiento {
  asignacionActual: { sedeId: string; sedeNombre: string; fechaFinCalculado: string | null } | null;
  nuevaAsignacion: { sedeNombre: string; fechaInicio: string; fechaFin: string | null };
  proximaAsignacion: { sedeNombre: string; fechaInicio: string } | null;
  conflicto: { mensaje: string } | null;
  // El movimiento pisa días de vacaciones del profesional → bloquea el guardado.
  vacaciones: { desde: string; hasta: string; dias: number; mensaje: string } | null;
  descripcion: string;
}

export interface CitaPendiente {
  id: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  estado: string;
  paciente: { nombreCompleto: string; telefono: string; email: string | null };
  servicio: string;
  sede: string;
}

export interface VerificarCitasResult {
  bloqueado: boolean;
  totalCitas: number;
  resumenPorDia: { fecha: string; cantidad: number }[];
  citas: CitaPendiente[];
}

export const movimientosApi = {
  listar: (params?: {
    profesionalId?: string;
    sedeId?: string;
    estado?: 'activo' | 'proximo' | 'historial';
  }) => api.get<Movimiento[]>('/movimientos', params as Record<string, string>),

  preview: (params: {
    profesionalId: string;
    sedeId: string;
    fechaInicio: string;
    fechaFin?: string | null;
  }) =>
    api.get<PreviewMovimiento>('/movimientos/preview', {
      profesionalId: params.profesionalId,
      sedeId: params.sedeId,
      fechaInicio: params.fechaInicio,
      ...(params.fechaFin ? { fechaFin: params.fechaFin } : {}),
    } as Record<string, string>),

  crear: (data: {
    profesionalId: string;
    sedeId: string;
    fechaInicio: string;
    fechaFin?: string | null;
    motivo: MotivoMovimiento;
    reemplazaA?: string | null;
    notas?: string | null;
  }) => api.post<Movimiento>('/movimientos', data),

  editar: (
    id: string,
    data: { profesionalId?: string; sedeId?: string; fechaInicio?: string; fechaFin?: string | null; motivo?: MotivoMovimiento; notas?: string | null },
  ) => api.put<Movimiento>(`/movimientos/${id}`, data),

  eliminar: (id: string) => api.delete(`/movimientos/${id}`),

  impacto: (id: string) =>
    api.get<{
      tienePredecesor: boolean;
      sedeAnteriorNombre: string | null;
      citasAfectadas: number;
      profesional: string;
      sede: string;
    }>(`/movimientos/${id}/impacto`),

  verificarCitas: (params: { profesionalId: string; fechaInicio: string; fechaFin?: string | null }) =>
    api.get<VerificarCitasResult>('/movimientos/verificar-citas', {
      profesionalId: params.profesionalId,
      fechaInicio: params.fechaInicio,
      ...(params.fechaFin ? { fechaFin: params.fechaFin } : {}),
    } as Record<string, string>),

  gestionarCita: (id: string, data: { estado: 'cancelada' | 'reprogramada'; motivo?: string }) =>
    api.patch<{ ok: boolean; id: string; estadoAnterior: string; estadoNuevo: string }>(`/citas/${id}/gestionar-movimiento`, data),
};
