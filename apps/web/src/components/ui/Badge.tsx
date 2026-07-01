import { cn } from '../../utils/cn';

type Estado = 'agendada' | 'confirmada' | 'llego' | 'en_atencion' | 'completada' | 'no_show' | 'cancelada' | 'reprogramada';

const LABELS: Record<Estado, string> = {
  agendada: 'Agendada',
  confirmada: 'Confirmada',
  llego: 'Llegó',
  en_atencion: 'En atención',
  completada: 'Completada',
  no_show: 'No show',
  cancelada: 'Cancelada',
  reprogramada: 'Reprogramada',
};

interface BadgeEstadoProps {
  estado: Estado;
  className?: string;
}

export function BadgeEstado({ estado, className }: BadgeEstadoProps) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full border px-2 py-0.5 text-xxs font-semibold uppercase tracking-wide',
      `badge-${estado}`,
      className
    )}>
      {LABELS[estado]}
    </span>
  );
}

interface BadgeSesionProps {
  numero: number;
  total: number;
}

export function BadgeSesion({ numero, total }: BadgeSesionProps) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded bg-white/25 px-1.5 py-0.5 text-xxs font-bold">
      Ses. {numero}/{total}
    </span>
  );
}
