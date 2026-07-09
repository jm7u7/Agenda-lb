// Alerta de comportamiento del paciente (no-show / reprogramador frecuente).
// Se muestra como un rombo amarillo en todo punto de contacto (agenda, popover,
// nueva cita, búsqueda, ficha) para que recepción y contact center lo sepan de
// primera impresión.

export interface AlertaPaciente {
  noShows: number;
  reprogramaciones: number;
  // Asistencia histórica SOLO de Limablue Agenda (no Genexis).
  asistidas?: number;
  totalResueltas?: number;
  porcentajeAsistencia?: number | null;
  frecuenteInasistente: boolean;
  frecuenteReprogramador: boolean;
  alerta: boolean;
}

function textoAlerta(a: AlertaPaciente): string {
  const partes: string[] = [];
  if (a.frecuenteInasistente) partes.push(`No asiste con frecuencia (${a.noShows} inasistencias)`);
  if (a.frecuenteReprogramador) partes.push(`Reprograma con frecuencia (${a.reprogramaciones} veces)`);
  return partes.join(' · ');
}

interface RomboAlertaProps {
  alerta?: AlertaPaciente | null;
  /** Tamaño del rombo en px (lado del cuadrado antes de rotar). */
  size?: number;
  /** Muestra el texto del motivo al lado del rombo. */
  conTexto?: boolean;
}

/**
 * Rombo amarillo de alerta. No renderiza nada si el paciente no califica.
 */
export function RomboAlerta({ alerta, size = 12, conTexto = false }: RomboAlertaProps) {
  if (!alerta?.alerta) return null;
  const titulo = textoAlerta(alerta);

  return (
    <span
      className="inline-flex items-center gap-1 align-middle"
      title={`⚠ Paciente de atención: ${titulo}`}
      aria-label={`Alerta: ${titulo}`}
    >
      <span
        style={{ width: size, height: size }}
        className="inline-flex items-center justify-center rotate-45 rounded-[2px] bg-amber-400 border border-amber-500 shrink-0"
      >
        <span style={{ fontSize: size * 0.7, lineHeight: 1 }} className="-rotate-45 font-black text-amber-900">!</span>
      </span>
      {conTexto && <span className="text-[11px] font-semibold text-amber-700">{titulo}</span>}
    </span>
  );
}
