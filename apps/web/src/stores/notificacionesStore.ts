import { create } from 'zustand';
import type { NotificacionActiva } from '../api/notificaciones';

interface NotificacionesState {
  pendientes: NotificacionActiva[];
  setPendientes: (n: NotificacionActiva[]) => void;
  limpiar: () => void;
}

export const useNotificacionesStore = create<NotificacionesState>((set) => ({
  pendientes: [],
  setPendientes: (pendientes) => set({ pendientes }),
  limpiar: () => set({ pendientes: [] }),
}));
