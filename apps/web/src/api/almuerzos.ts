import { api } from './client';

export interface BloqueoAlmuerzo {
  id: string;
  profesionalId: string;
  sedeId: string;
  horaInicio: string;
  horaFin: string;
  motivo: string;
  creadoEn: string;
  profesional: {
    id: string;
    nombres: string;
    apellidos: string;
    tipo: string;
    colorAvatar: string;
  };
  creadoPorUsuario: { id: string; nombre: string } | null;
}

export const almuerzosApi = {
  listar: (sedeId: string) =>
    api.get<BloqueoAlmuerzo[]>('/almuerzos', { sedeId }),

  listarPorFecha: (sedeId: string, fecha: string) =>
    api.get<BloqueoAlmuerzo[]>('/almuerzos', { sedeId, fecha }),

  getPorProfesional: (profesionalId: string, sedeId: string) =>
    api.get<BloqueoAlmuerzo | null>(`/almuerzos/profesional/${profesionalId}`, { sedeId }),

  crear: (data: { profesionalId: string; sedeId: string; horaInicio: string }) =>
    api.post<BloqueoAlmuerzo>('/almuerzos', data),

  eliminar: (id: string) =>
    api.delete<{ ok: boolean }>(`/almuerzos/${id}`),
};
