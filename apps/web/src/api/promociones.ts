import { api } from './client';

export type TipoPromocion = 'PRECIO_FIJO' | 'PORCENTAJE' | 'OTRO';

export interface Promocion {
  id: string;
  nombre: string;
  descripcion?: string | null;
  tipo: TipoPromocion;
  valor: number | null;
  activo?: boolean;
  orden?: number;
  enUso?: number;
}

export interface CrearPromocionInput {
  nombre: string;
  descripcion?: string;
  tipo: TipoPromocion;
  valor?: number | null;
}

// Formato compartido del valor de una promo (drawer/popover/herramientas/analytics):
// PRECIO_FIJO → "S/ N"; PORCENTAJE → "N%"; OTRO/null → "—". Una sola fuente para no divergir.
export function formatPromoValor(tipo: TipoPromocion, valor: number | null | undefined): string {
  const n = valor == null ? null : Number(valor);
  if (tipo === 'PRECIO_FIJO' && n != null) return `S/ ${n % 1 === 0 ? n : n.toFixed(2)}`;
  if (tipo === 'PORCENTAJE' && n != null) return `${n}%`;
  return '—';
}

export const promocionesApi = {
  activas: () => api.get<Promocion[]>('/promociones'),
  todas: () => api.get<Promocion[]>('/promociones/todas'),
  crear: (data: CrearPromocionInput) => api.post<Promocion>('/promociones', data),
  actualizar: (id: string, data: Partial<{ nombre: string; descripcion: string | null; tipo: TipoPromocion; valor: number | null; activo: boolean; orden: number }>) =>
    api.patch<Promocion>(`/promociones/${id}`, data),
  eliminar: (id: string) =>
    api.delete<{ ok: boolean; desactivado?: boolean; eliminado?: boolean; enUso?: number }>(`/promociones/${id}`),
};
