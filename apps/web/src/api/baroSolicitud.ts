import { api } from './client';

export interface ProfBaro {
  id: string;
  nombre: string;
  tipo: string;
  activo?: boolean;
  servicios?: number;
}

export interface BaroSolicitudData {
  servicios: { id: string; nombre: string }[];
  porSolicitud: ProfBaro[];
  disponibles: ProfBaro[];
}

export const baroSolicitudApi = {
  obtener: () => api.get<BaroSolicitudData>('/baro-solicitud'),
  agregar: (profesionalId: string) => api.post<{ ok: boolean }>(`/baro-solicitud/${profesionalId}`, {}),
  quitar: (profesionalId: string) => api.delete<{ ok: boolean; desactivadas: number }>(`/baro-solicitud/${profesionalId}`),
};
