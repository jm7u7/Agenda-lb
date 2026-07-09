// Alerta "Actualizar datos" con estética de interruptor. El estado es CALCULADO
// (columna `requiereActualizacionDatos`, server-side): el agente NO puede apagarlo
// a mano — se apaga solo al completar los datos faltantes. Con el switch encendido,
// el clic abre la edición del paciente (el llamador decide cómo: modal o ficha).
// Se muestra en PopoverCita, ficha del paciente y resultados de búsqueda.

import { cn } from '../../utils/cn';
import { datosFaltantesCliente, type ContactoPaciente } from '../../utils/datosPaciente';

interface ToggleDatosPacienteProps {
  /** Bandera calculada server-side (autoridad del estado). */
  encendido: boolean;
  /** Lista server-side de faltantes (GET /:id, PATCH). Si no llega, se espeja del contacto. */
  faltantes?: string[];
  /** Datos de contacto para espejar el tooltip cuando `faltantes` no viene (ej. lista de citas). */
  contacto?: ContactoPaciente;
  /** Abre la edición del paciente. Solo se invoca con el switch encendido. */
  onEditar?: () => void;
  /** Versión chica sin etiqueta de texto (búsquedas, listas densas). */
  compacto?: boolean;
}

export function ToggleDatosPaciente({ encendido, faltantes, contacto, onEditar, compacto = false }: ToggleDatosPacienteProps) {
  const lista = faltantes ?? (contacto ? datosFaltantesCliente(contacto) : []);
  const tooltip = encendido
    ? `Falta: ${lista.length > 0 ? lista.join(', ') : 'datos por completar'}${onEditar ? ' — clic para completar' : ''}`
    : 'Datos completos';

  const Tag = encendido && onEditar ? 'button' : 'span';

  return (
    <Tag
      {...(Tag === 'button' ? { type: 'button' as const, onClick: onEditar } : {})}
      title={tooltip}
      aria-label={tooltip}
      className={cn(
        'inline-flex items-center gap-1.5 align-middle select-none',
        Tag === 'button' && 'cursor-pointer group'
      )}
    >
      {/* Pastilla deslizante */}
      <span
        className={cn(
          'relative inline-flex shrink-0 rounded-full transition-colors',
          compacto ? 'w-7 h-4' : 'w-9 h-5',
          encendido ? 'bg-amber-400 animate-pulse [animation-duration:2.5s]' : 'bg-emerald-500'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 rounded-full bg-white shadow transition-transform',
            compacto ? 'w-3 h-3' : 'w-4 h-4',
            encendido ? 'left-0.5' : compacto ? 'left-0.5 translate-x-3' : 'left-0.5 translate-x-4'
          )}
        />
      </span>
      {!compacto && (
        <span
          className={cn(
            'text-xs font-semibold whitespace-nowrap',
            encendido ? 'text-amber-700 group-hover:underline' : 'text-emerald-700'
          )}
        >
          {encendido ? 'Actualizar datos' : 'Datos completos'}
        </span>
      )}
    </Tag>
  );
}
