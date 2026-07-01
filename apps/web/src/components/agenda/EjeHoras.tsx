import { generarSlotsDelDia } from '@limablue/shared';

const SLOT_HEIGHT = 40;

interface EjeHorasProps {
  /** Hora de apertura de la sede ese día ("HH:mm"). Por defecto 08:00. */
  apertura?: string;
  /** Hora de cierre de la sede ese día ("HH:mm"). Por defecto 20:00. */
  cierre?: string;
}

export function EjeHoras({ apertura = '08:00', cierre = '20:00' }: EjeHorasProps) {
  const horas = generarSlotsDelDia(apertura, cierre, 30);
  return (
    <div className="w-12 flex-shrink-0 bg-white border-r border-slate-200">
      <div className="h-14 border-b border-slate-200" /> {/* Espacio para cabecera */}
      {horas.map(hora => (
        <div key={hora} className="hora-label" style={{ height: SLOT_HEIGHT }}>
          {hora.endsWith(':00') ? hora : ''}
        </div>
      ))}
    </div>
  );
}
