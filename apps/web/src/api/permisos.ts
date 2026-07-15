import { api } from './client';

export interface Permiso {
  id: string;
  profesionalId: string;
  sedeId: string | null;
  horaInicio: string | null; // "HH:mm"
  horaFin: string | null;    // "HH:mm"
  motivo: string;
  esReunion?: boolean; // true = reunión administrativa (Daniel/Yasica) → verde; false = permiso → rojo
  esVacaciones?: boolean; // true = vacaciones planificadas → franja 🌴 (día completo)
  creadoEn: string;
  profesional: { id: string; nombres: string; apellidos: string; tipo: string; colorAvatar: string };
  creadoPorUsuario: { id: string; nombre: string } | null;
}

export const permisosApi = {
  listarPorFecha: (sedeId: string, fecha: string) =>
    api.get<Permiso[]>('/permisos', { sedeId, fecha }),
  crear: (data: { profesionalId: string; sedeId: string; fecha: string; horaInicio: string; horaFin: string; motivo: string }) =>
    api.post<Permiso>('/permisos', data),
  // Bloquear VARIOS a la vez: bloquea a los libres, reporta los que tienen pacientes.
  crearMultiple: (data: { profesionalIds: string[]; sedeId: string; fecha: string; horaInicio: string; horaFin: string; motivo: string }) =>
    api.post<{
      creados: { id: string; profesionalId: string; nombre: string }[];
      conflictos: { profesionalId: string; nombre: string; citas: { horaInicio: string; paciente: string; telefono: string; servicio: string; estado: string }[] }[];
      invalidos: { profesionalId: string; motivo: string }[];
    }>('/permisos/multiple', data),
  // Reunión de Daniel y/o Yasica Doy. `destinatario`: 3 escenarios (solo Daniel, solo Yasica, ambos).
  crearReunion: (data: { fecha: string; horaInicio: string; horaFin: string; motivo: string; destinatario: 'daniel' | 'yasica' | 'ambos' }) =>
    api.post<{ ok: boolean; creados: Permiso[]; profesionales: string[] }>('/permisos/reunion', data),
  eliminar: (id: string) =>
    api.delete<{ ok: boolean }>(`/permisos/${id}`),
  // Vacaciones: preview (dry-run rojo/verde) y creación en bloque (día completo por cada día del rango).
  previewVacaciones: (data: { profesionalIds: string[]; sedeId: string; fechaInicio: string; fechaFin: string }) =>
    api.post<VacacionesPreview>('/permisos/vacaciones/preview', data),
  crearVacaciones: (data: { profesionalIds: string[]; sedeId: string; fechaInicio: string; fechaFin: string; motivo: string }) =>
    api.post<{ ok: boolean; creados: number; dias: number; profesionales: string[]; invalidos: { profesionalId: string; motivo: string }[] }>('/permisos/vacaciones', data),
  // Resumen de TODAS las vacaciones vigentes, agrupadas por rango (no por día).
  listarVacaciones: (params?: { sedeId?: string; profesionalId?: string }) =>
    api.get<VacacionGrupo[]>('/permisos/vacaciones', params as Record<string, string> | undefined),
  // Elimina una vacación COMPLETA (todas sus filas de una vez).
  eliminarVacacion: (ids: string[]) =>
    api.post<{ ok: boolean; eliminados: number }>('/permisos/vacaciones/eliminar', { ids }),
  // Edita el rango/motivo de una vacación (borra las filas viejas y crea el nuevo rango).
  editarVacacion: (data: { ids: string[]; sedeId: string; fechaInicio: string; fechaFin: string; motivo: string }) =>
    api.patch<{ ok: boolean; creados: number; dias: number }>('/permisos/vacaciones', data),
};

// Una vacación vigente agrupada como rango (lo que devuelve GET /permisos/vacaciones).
export interface VacacionGrupo {
  profesionalId: string;
  profesional: { id: string; nombres: string; apellidos: string; tipo: string; colorAvatar: string | null };
  sedeId: string | null;
  sede: { id: string; nombre: string; color: string | null } | null;
  motivo: string;
  fechaInicio: string; // YYYY-MM-DD
  fechaFin: string;    // YYYY-MM-DD
  dias: number;
  ids: string[];
}

export interface VacacionesConflictoCita { fecha: string; horaInicio: string; paciente: string; telefono: string; servicio: string; estado: string }
export interface VacacionesProfReporte { profesionalId: string; nombre: string; bloqueable: boolean; conflictos: VacacionesConflictoCita[] }
export interface VacacionesPreview {
  ok: boolean;
  dias: number;
  totalConflictos: number;
  totalBloqueos: number;
  profesionales: VacacionesProfReporte[];
  invalidos: { profesionalId: string; motivo: string }[];
}
