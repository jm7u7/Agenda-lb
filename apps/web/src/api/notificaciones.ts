import { api } from './client';

export interface NotificacionActiva {
  id: string;
  mensaje: string;
  activaHasta: string;
  todasLasSedes: boolean;
  creadoEn: string;
  autor: { id: string; nombre: string };
  sedes: { id: string; nombre: string }[];
}

export interface NotificacionAdmin extends NotificacionActiva {
  activaDesde: string;
  totalVistas: number;
  estaActiva: boolean;
}

export interface CrearNotificacionInput {
  mensaje: string;
  activaHasta: string;
  todasLasSedes: boolean;
  sedeIds?: string[];
}

export const notificacionesApi = {
  getActivas: () => api.get<NotificacionActiva[]>('/notificaciones/activas'),

  marcarVista: (id: string) => api.post<{ ok: boolean }>(`/notificaciones/${id}/vista`),

  admin: {
    listar: () => api.get<NotificacionAdmin[]>('/notificaciones/admin'),
    crear: (data: CrearNotificacionInput) =>
      api.post<NotificacionAdmin>('/notificaciones/admin', data),
    editar: (id: string, data: Partial<CrearNotificacionInput>) =>
      api.put<NotificacionAdmin>(`/notificaciones/admin/${id}`, data),
    eliminar: (id: string) => api.delete<{ ok: boolean }>(`/notificaciones/admin/${id}`),
  },
};
