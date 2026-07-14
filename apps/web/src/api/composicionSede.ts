import { api } from './client';
import { useAuthStore } from '../stores/authStore';

export interface PersonaRoster {
  id: string;
  nombre: string;
  desde: string;          // DD/MM/YYYY (recortado al mes)
  hasta: string;          // DD/MM/YYYY (recortado al mes)
  indefinido: boolean;    // true = asignación sin fecha de fin
  notas?: string | null;
  asignacionId?: string;  // solo doctores/recepcionistas (roster editable)
}
export interface SedeComposicion {
  sedeId: string; nombre: string;
  podologas: PersonaRoster[]; fisioterapeutas: PersonaRoster[]; doctores: PersonaRoster[]; recepcionistas: PersonaRoster[];
}
export interface Composicion { mes: string; mesLabel: string; inicio: string; fin: string; sedes: SedeComposicion[] }

export interface Recepcionista { id: string; nombre: string; activo: boolean; deletedAt: string | null; creadoEn: string }
export interface DoctorOpcion { id: string; nombre: string }
export interface AsignacionAdmin {
  id: string; sedeId: string; sedeNombre: string;
  fechaInicio: string; fechaFin: string | null; notas: string | null;
  cargo: 'doctor' | 'recepcionista'; personaId: string | null; personaNombre: string;
}

const BASE = '/composicion-sede';

export const composicionSedeApi = {
  composicion: (mes: string) => api.get<Composicion>(`${BASE}/composicion`, { mes }),
  doctores: () => api.get<DoctorOpcion[]>(`${BASE}/doctores`),

  recepcionistas: () => api.get<Recepcionista[]>(`${BASE}/recepcionistas`),
  crearRecepcionista: (nombre: string) => api.post<Recepcionista>(`${BASE}/recepcionistas`, { nombre }),
  editarRecepcionista: (id: string, data: { nombre?: string; activo?: boolean }) => api.patch<Recepcionista>(`${BASE}/recepcionistas/${id}`, data),
  eliminarRecepcionista: (id: string) => api.delete<{ ok: boolean }>(`${BASE}/recepcionistas/${id}`),

  asignaciones: (mes?: string) => api.get<AsignacionAdmin[]>(`${BASE}/asignaciones`, mes ? { mes } : undefined),
  crearAsignacion: (data: { sedeId: string; fechaInicio: string; fechaFin?: string | null; profesionalId?: string | null; recepcionistaId?: string | null; notas?: string }) =>
    api.post<{ id: string }>(`${BASE}/asignaciones`, data),
  editarAsignacion: (id: string, data: { sedeId?: string; fechaInicio?: string; fechaFin?: string | null; notas?: string | null }) =>
    api.patch<{ id: string }>(`${BASE}/asignaciones/${id}`, data),
  eliminarAsignacion: (id: string) => api.delete<{ ok: boolean }>(`${BASE}/asignaciones/${id}`),

  // PDF: descarga por blob con el token (mismo patrón que exportar/*).
  descargarPDF: async (mes: string) => {
    const token = useAuthStore.getState().token;
    const res = await fetch(`/api/v1${BASE}/composicion.pdf?mes=${mes}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.message || e.error || 'Error al generar el PDF');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `composicion-sedes-${mes}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
