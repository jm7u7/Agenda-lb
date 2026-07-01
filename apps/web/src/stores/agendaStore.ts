import { create } from 'zustand';
import { format } from 'date-fns';

interface AgendaState {
  sedeId: string | null;
  fecha: Date;
  unidadNegocioId: string | null;
  vistaActiva: 'dia' | 'semana';
  modoRedistribucion: boolean;
  profesionalRedistribucionId: string | null;

  setSedeId: (id: string) => void;
  setFecha: (d: Date) => void;
  setUnidadNegocioId: (id: string | null) => void;
  setVistaActiva: (v: 'dia' | 'semana') => void;
  toggleModoRedistribucion: (profesionalId?: string) => void;
  fechaStr: () => string;
}

export const useAgendaStore = create<AgendaState>((set, get) => ({
  sedeId: null,
  fecha: new Date(),
  unidadNegocioId: null,
  vistaActiva: 'dia',
  modoRedistribucion: false,
  profesionalRedistribucionId: null,

  setSedeId: (id) => set({ sedeId: id }),
  setFecha: (d) => set({ fecha: d }),
  setUnidadNegocioId: (id) => set({ unidadNegocioId: id }),
  setVistaActiva: (v) => set({ vistaActiva: v }),
  toggleModoRedistribucion: (profesionalId) =>
    set(s => ({
      modoRedistribucion: !s.modoRedistribucion || !!profesionalId,
      profesionalRedistribucionId: profesionalId ?? null,
    })),
  fechaStr: () => format(get().fecha, 'yyyy-MM-dd'),
}));
