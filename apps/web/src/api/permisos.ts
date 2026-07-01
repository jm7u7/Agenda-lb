import { api } from './client';

export interface Permiso {
  id: string;
  profesionalId: string;
  sedeId: string | null;
  horaInicio: string | null; // "HH:mm"
  horaFin: string | null;    // "HH:mm"
  motivo: string;
  esReunion?: boolean; // true = reunión administrativa (Daniel/Yasica) → verde; false = permiso → rojo
  creadoEn: string;
  profesional: { id: string; nombres: string; apellidos: string; tipo: string; colorAvatar: string };
  creadoPorUsuario: { id: string; nombre: string } | null;
}

export const permisosApi = {
  listarPorFecha: (sedeId: string, fecha: string) =>
    api.get<Permiso[]>('/permisos', { sedeId, fecha }),
  crear: (data: { profesionalId: string; sedeId: string; fecha: string; horaInicio: string; horaFin: string; motivo: string }) =>
    api.post<Permiso>('/permisos', data),
  // Reunión de Daniel y/o Yasica Doy. `destinatario`: 3 escenarios (solo Daniel, solo Yasica, ambos).
  crearReunion: (data: { fecha: string; horaInicio: string; horaFin: string; motivo: string; destinatario: 'daniel' | 'yasica' | 'ambos' }) =>
    api.post<{ ok: boolean; creados: Permiso[]; profesionales: string[] }>('/permisos/reunion', data),
  eliminar: (id: string) =>
    api.delete<{ ok: boolean }>(`/permisos/${id}`),
};
