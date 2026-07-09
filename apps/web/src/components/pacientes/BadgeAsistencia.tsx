// Asistencia histórica del paciente — SOLO datos de Limablue Agenda (nunca Genexis).
// Le da al agente que reserva una señal para tomar precauciones al dar horarios:
// verde = asiste bien, ámbar = irregular, rojo = falta seguido.
// El % viene calculado del backend (alertaPaciente): asistidas / (asistidas + no-show).

import { cn } from '../../utils/cn';
import type { AlertaPaciente } from './RomboAlerta';

interface BadgeAsistenciaProps {
  alerta?: AlertaPaciente | null;
  /** Compacto (una pastilla chica) para listas; por defecto muestra etiqueta. */
  compacto?: boolean;
}

function colorAsistencia(pct: number): { cls: string; label: string } {
  if (pct >= 80) return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'buena asistencia' };
  if (pct >= 50) return { cls: 'bg-amber-50 text-amber-700 border-amber-300', label: 'asistencia irregular' };
  return { cls: 'bg-red-50 text-red-600 border-red-200', label: 'falta con frecuencia' };
}

export function BadgeAsistencia({ alerta, compacto = false }: BadgeAsistenciaProps) {
  if (!alerta) return null;
  const total = alerta.totalResueltas ?? 0;

  // Sin citas resueltas en Limablue todavía (paciente nuevo o solo con historia
  // Genexis): no inventamos un %, lo decimos explícito.
  if (total === 0 || alerta.porcentajeAsistencia == null) {
    if (compacto) return null;
    return (
      <span
        title="Aún no tiene citas con asistencia registrada en Limablue Agenda"
        className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500"
      >
        📊 Asistencia: sin historial aún
      </span>
    );
  }

  const pct = alerta.porcentajeAsistencia;
  const { cls, label } = colorAsistencia(pct);
  const tooltip = `Asistencia en Limablue: ${alerta.asistidas} de ${total} citas (${label}). Solo cuenta atenciones de esta agenda, no Genexis.`;

  return (
    <span
      title={tooltip}
      className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold', compacto ? 'text-[10px]' : 'text-[11px]', cls)}
    >
      📊 {pct}%{!compacto && <span className="font-normal">asistencia · {total} cita{total === 1 ? '' : 's'}</span>}
    </span>
  );
}
