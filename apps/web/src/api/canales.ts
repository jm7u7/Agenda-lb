import { api } from './client';

export interface Canal {
  id: string;
  valor: string;
  etiqueta: string;
  orden: number;
  activo?: boolean;
  enUso?: number;
}

export const canalesApi = {
  activos: () => api.get<Canal[]>('/canales'),
  todos: () => api.get<Canal[]>('/canales/todos'),
  crear: (etiqueta: string) => api.post<Canal>('/canales', { etiqueta }),
  actualizar: (id: string, data: Partial<{ etiqueta: string; activo: boolean; orden: number }>) =>
    api.patch<Canal>(`/canales/${id}`, data),
  eliminar: (id: string) =>
    api.delete<{ ok: boolean; desactivado?: boolean; eliminado?: boolean; enUso?: number }>(`/canales/${id}`),
};
