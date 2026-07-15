// Módulo Sesiones/Paquetes/Membresías — UN endpoint de saldos + UNA queryKey.
// PROHIBIDO duplicar la lógica de saldo: toda vista consume `usePaquetesPaciente`
// (misma queryKey) y el saldo llega CALCULADO del servidor (derivado de consumos).

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export const paquetesPacienteKey = (pacienteId: string) => ['paquetes-sesiones', pacienteId] as const;

export interface ConsumoTimeline {
  id: string;
  fecha: string; // "YYYY-MM-DD"
  origen: 'APERTURA' | 'CITA' | 'AJUSTE_MANUAL';
  motivo: string | null;
  registradoPor: string | null;
  tipoSesion: string | null;
  cita: {
    id: string;
    fecha: string;
    horaInicio: string;
    sede: { nombre: string };
    profesional: { nombres: string; apellidos: string } | null;
    servicio: { nombre: string };
  } | null;
}

export interface ItemComposicion {
  servicioId: string;
  cantidad: number;
  etiqueta: string;
  consumidas: number;
  // Subcategoría FIJADA al vender (ej. Profilaxis → Premium). Presente = solo consume
  // esa subcategoría; ausente = cualquier subcategoría del servicio.
  subcategoriaId?: string | null;
  subcategoriaEtiqueta?: string;
}

export interface PaquetePacienteSaldo {
  id: string;
  nombre: string;
  tipo: 'PAQUETE' | 'MEMBRESIA' | 'UNITARIA';
  origen: 'AGENDA' | 'GENEXIS_APERTURA';
  sesionesTotal: number;
  consumidas: number;
  saldo: number;
  estado: 'ACTIVO' | 'AGOTADO' | 'VENCIDO' | 'ANULADO';
  sede: { id: string; nombre: string; color: string } | null;
  servicioNuevoId: string | null;
  servicioNuevo: { id: string; nombre: string } | null;
  vigenciaInicio: string | null;
  vigenciaFin: string | null;
  familia: string | null;
  composicion: ItemComposicion[] | null;
  consumos: ConsumoTimeline[];
  conciliacion: {
    lecturaServicio: number | null;
    lecturaObs: number | null;
    consumoAprobado: number | null;
    ajusteProCliente: boolean;
    decididoPor: string | null;
    decididoEn: string | null;
    confianza: string;
  } | null;
}

export const paquetesSesionesApi = {
  dePaciente: (pacienteId: string) => api.get<PaquetePacienteSaldo[]>(`/pacientes/${pacienteId}/paquetes`),
  consumirDeCita: (citaId: string, paquetePacienteId: string) =>
    api.post<{ numeroSesion: number; saldo: number; estado: string }>(`/consumos/cita/${citaId}`, { paquetePacienteId }),
  consumoManual: (paquetePacienteId: string, data: { citaId?: string; motivo?: string }) =>
    api.post<{ numeroSesion: number; saldo: number; estado: string }>('/consumos/manual', { paquetePacienteId, ...data }),
  anularConsumo: (consumoId: string, motivo: string) =>
    api.post<{ saldo: number; estado: string }>(`/consumos/${consumoId}/anular`, { motivo }),
  // "No aplicar / no descontar la sesión" (ej. láser no aplicado). exonerar=false quita la marca.
  exonerarSesion: (citaId: string, exonerar: boolean, motivo?: string) =>
    api.post<{ exonerada: boolean; devolvioConsumo?: boolean; saldo?: number | null }>(`/consumos/cita/${citaId}/exonerar`, { exonerar, motivo }),
  // Corregir tamaño del paquete — SOLO admin (recepción eligió mal, ej. 12 → 4).
  corregirTamano: (paquetePacienteId: string, sesionesTotal: number, motivo: string) =>
    api.patch<{ saldo: number; estado: string }>(`/paquetes/instancia/${paquetePacienteId}/tamano`, { sesionesTotal, motivo }),
};

/** Hook ÚNICO de saldos: misma queryKey en todas las vistas. */
export function usePaquetesPaciente(pacienteId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: paquetesPacienteKey(pacienteId ?? ''),
    queryFn: () => paquetesSesionesApi.dePaciente(pacienteId!),
    enabled: !!pacienteId && enabled,
    staleTime: 30_000,
  });
}

/** Invalida los saldos del paciente en TODAS las vistas a la vez. */
export function useInvalidarPaquetes() {
  const qc = useQueryClient();
  return (pacienteId: string) => {
    void qc.invalidateQueries({ queryKey: paquetesPacienteKey(pacienteId) });
    void qc.invalidateQueries({ queryKey: ['citas'] }); // badges Sesión x/total
    void qc.invalidateQueries({ queryKey: ['paciente', pacienteId] });
  };
}

// ¿El paquete corresponde a (servicio, subcategoría)? Membresía (con composición) →
// SOLO por sus ítems (subcategoría-aware, para que una "Premium" no consuma "Regular");
// paquete simple → por el servicio resuelto (sin subcategoría). Espeja el backend.
function paqueteCorresponde(p: PaquetePacienteSaldo, servicioId: string, subcategoriaId: string | null, conSaldo: boolean): boolean {
  const comp = p.composicion ?? [];
  if (comp.length > 0) {
    return comp.some(
      (i) =>
        i.servicioId === servicioId &&
        (!i.subcategoriaId || i.subcategoriaId === subcategoriaId) &&
        (!conSaldo || i.consumidas < i.cantidad)
    );
  }
  return p.servicioNuevoId === servicioId;
}

/** ¿La fecha de la cita cae dentro de la vigencia [inicio, fin] del paquete? (si no hay fecha, no filtra) */
function vigente(p: PaquetePacienteSaldo, fecha: string | null): boolean {
  if (!fecha) return true;
  if (p.vigenciaInicio && fecha < p.vigenciaInicio) return false;
  if (p.vigenciaFin && fecha > p.vigenciaFin) return false;
  return true;
}

/** Elegibles para una cita (servicio + SEDE + VIGENCIA por fecha de la cita) en orden FIFO. */
export function paquetesElegibles(
  paquetes: PaquetePacienteSaldo[] | undefined,
  servicioId: string,
  sedeId: string,
  subcategoriaId: string | null = null,
  fecha: string | null = null,
) {
  return (paquetes ?? []).filter(
    (p) => p.estado === 'ACTIVO' && p.sede?.id === sedeId && vigente(p, fecha) && paqueteCorresponde(p, servicioId, subcategoriaId, true)
  );
}

/** Paquetes del servicio correcto pero de OTRA sede (aviso "pertenece a {sede}"). */
export function paquetesOtraSede(
  paquetes: PaquetePacienteSaldo[] | undefined,
  servicioId: string,
  sedeId: string,
  subcategoriaId: string | null = null,
  fecha: string | null = null,
) {
  return (paquetes ?? []).filter(
    (p) => p.estado === 'ACTIVO' && p.sede && p.sede.id !== sedeId && vigente(p, fecha) && paqueteCorresponde(p, servicioId, subcategoriaId, false)
  );
}
