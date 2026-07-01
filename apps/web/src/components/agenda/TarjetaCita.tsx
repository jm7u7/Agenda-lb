import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '../../utils/cn';
import type { CitaResumen } from '../../api/citas';
import { RomboAlerta } from '../pacientes/RomboAlerta';

interface TarjetaCitaProps {
  cita: CitaResumen;
  onClick: (cita: CitaResumen) => void;
  slotHeight?: number; // px por 30 min
}

// Colores base por estado — para citas de 60+ min (sólido, mayor peso visual)
const COLORES_ESTADO: Record<string, string> = {
  agendada:    '#64748B',
  confirmada:  '#3B82F6',
  llego:       '#22C55E',
  en_atencion: '#F59E0B',
  completada:  '#475569',
  no_show:     '#F87171',
  cancelada:   '#94A3B8',
  reprogramada:'#8B5CF6',
};

// Colores atenuados para citas de 30 min — mismo tono pero más claro/translúcido
const COLORES_ESTADO_30: Record<string, string> = {
  agendada:    '#94A3B8',
  confirmada:  '#93C5FD',
  llego:       '#86EFAC',
  en_atencion: '#FCD34D',
  completada:  '#94A3B8',
  no_show:     '#FCA5A5',
  cancelada:   '#CBD5E1',
  reprogramada:'#C4B5FD',
};

// Acento lateral para citas de 30 min (franja izquierda de color distintivo)
const ACENTO_30: Record<string, string> = {
  agendada:    '#475569',
  confirmada:  '#1D4ED8',
  llego:       '#15803D',
  en_atencion: '#B45309',
  completada:  '#334155',
  no_show:     '#DC2626',
  cancelada:   '#64748B',
  reprogramada:'#6D28D9',
};

export function TarjetaCita({ cita, onClick, slotHeight = 40 }: TarjetaCitaProps) {
  const slots = cita.duracionMinutos / 30;
  const height = slots * slotHeight - 4;
  const es30min = cita.duracionMinutos <= 30;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: cita.id,
    data: { cita },
    disabled: cita.estado === 'completada' || cita.estado === 'cancelada' || cita.estado === 'no_show',
  });

  const bgColor = es30min
    ? (COLORES_ESTADO_30[cita.estado] ?? '#94A3B8')
    : (COLORES_ESTADO[cita.estado] ?? '#64748B');

  const textColor = es30min ? '#1e293b' : '#ffffff';
  const textMuted = es30min ? '#475569' : 'rgba(255,255,255,0.75)';

  const style = {
    height: `${height}px`,
    backgroundColor: bgColor,
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : 1,
    touchAction: 'none',
    borderLeft: es30min ? `3px solid ${ACENTO_30[cita.estado] ?? '#475569'}` : undefined,
  };

  const nombrePaciente = `${cita.paciente.nombres} ${cita.paciente.apellidoPaterno}`;
  const tieneSesion = cita.paquetePaciente && cita.sesionNumero;
  // Mitad de un bloque combinado cuya otra mitad la atiende OTRA profesional (vive en
  // otra columna). Se marca con un eslabón para que se note que es un bloque enlazado.
  const esMitadDeBloque = !!cita.slotGrupoId;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={(e) => { e.stopPropagation(); onClick(cita); }}
      className={cn(
        'cita-card absolute left-1 right-1 overflow-hidden',
        isDragging && 'dragging',
        cita.estado === 'cancelada' && 'opacity-50'
      )}
      role="button"
      tabIndex={0}
      aria-label={`Cita de ${nombrePaciente} — ${cita.servicio.nombre}`}
    >
      {/* Indicador de canal (WhatsApp / web) */}
      {cita.canal !== 'recepcion' && !es30min && (
        <div
          className="absolute left-0 top-0 bottom-0 w-0.5 bg-white/50"
          title={cita.canal === 'whatsapp' ? 'Agendado por WhatsApp' : 'Agendado por web'}
        />
      )}

      {/* Eslabón: esta cita es parte de un bloque combinado (la otra mitad está en
          otra columna). Eliminarla cancela el bloque completo. */}
      {esMitadDeBloque && (
        <span
          title={`Bloque combinado (${cita.slotRol === 'PRINCIPAL' ? 'profilaxis' : 'extra'}) — la otra cita está en otra columna`}
          style={{ position: 'absolute', left: '2px', bottom: '2px', fontSize: '9px', lineHeight: 1, zIndex: 2 }}
        >
          🔗
        </span>
      )}

      {/* Círculo de número de sesión — siempre visible si hay paquete */}
      {tieneSesion && (
        <div
          title={`Sesión ${cita.sesionNumero} de ${cita.paquetePaciente!.sesionesTotal} · ${cita.paquetePaciente!.paquete.nombre}`}
          style={{
            position: 'absolute',
            top: '2px',
            right: '2px',
            width: '16px',
            height: '16px',
            borderRadius: '50%',
            background: '#DC2626',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '9px',
            fontWeight: 700,
            color: '#fff',
            lineHeight: 1,
            flexShrink: 0,
            zIndex: 2,
          }}
        >
          {cita.sesionNumero}
        </div>
      )}

      <div
        className="flex flex-col h-full overflow-hidden"
        style={{
          paddingLeft: es30min ? '4px' : '6px',
          paddingTop: '2px',
          paddingRight: tieneSesion ? '20px' : (es30min ? '3px' : '4px'),
        }}
      >
        {/* Nombre del paciente — siempre visible. Rombo amarillo si es paciente de atención. */}
        <p
          className="font-semibold leading-tight truncate flex items-center gap-1"
          style={{ fontSize: es30min ? '10px' : '11px', color: textColor }}
        >
          <RomboAlerta alerta={cita.paciente.alerta} size={es30min ? 9 : 10} />
          <span className="truncate">{nombrePaciente}</span>
        </p>

        {/* Nombre del servicio. En tarjetas cortas con médico solicitado se omite
            (lo reemplaza la línea "Solo X") para que no se corte el texto. */}
        {(!cita.solicitadoProfesional || height > 52) && (
          <p
            className="truncate leading-tight"
            style={{ fontSize: '9px', color: textMuted, marginTop: '1px' }}
          >
            {cita.servicio.nombre}
          </p>
        )}

        {/* Total de sesiones — solo en citas largas */}
        {height > 60 && tieneSesion && (
          <p style={{ fontSize: '9px', color: textMuted, marginTop: '1px' }}>
            {cita.sesionNumero}/{cita.paquetePaciente!.sesionesTotal} sesiones
          </p>
        )}

        {/* Médico SOLICITADO "Solo X" (baro): la cita ocupa una máquina. Info clave →
            se muestra siempre (en ámbar para destacar), aun en tarjetas de 30 min. */}
        {cita.solicitadoProfesional && (
          <p className="truncate leading-tight" style={{ fontSize: '9px', fontWeight: 700, color: '#b45309', marginTop: '1px' }}>
            🙋 Solo {cita.solicitadoProfesional.nombres.split(' ')[0]}
          </p>
        )}

        {/* Preferencia de profesional (podología): solo en tarjetas con espacio. */}
        {!cita.solicitadoProfesional && height > 36 && cita.origenAsignacion && (
          <span style={{ fontSize: '9px', color: textMuted, marginTop: '1px' }}>
            {cita.origenAsignacion === 'elegida_por_paciente'
              ? `Solo ${cita.profesional?.nombres?.split(' ')[0] ?? ''}`
              : 'CP'}
          </span>
        )}
      </div>

    </div>
  );
}

// ─── Tarjeta PARTIDA: bloque combinado (profilaxis ancla + extra) ─────────────
// Solo se usa cuando AMBAS mitades comparten columna (misma profesional), así que la
// profesional es la de la columna y no se repite por mitad. Cada mitad es clicable y
// abre el popover de SU cita. La altura = la del ancla (1 hora física = 2 sub-slots).
interface TarjetaCombinadaProps {
  principal: CitaResumen;
  secundario: CitaResumen;
  onClick: (cita: CitaResumen) => void;
  slotHeight?: number;
}

// Una mitad = UNA sola línea: nombre del servicio truncado con "…" + (opcional) el
// círculo de sesión, todo centrado verticalmente. Sin segunda línea → no se corta.
function MitadCita({ cita, onClick, top }: { cita: CitaResumen; onClick: (c: CitaResumen) => void; top: boolean }) {
  const tieneSesion = cita.paquetePaciente && cita.sesionNumero;
  const bg = COLORES_ESTADO[cita.estado] ?? '#64748B';
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(cita); }}
      className="flex-1 min-h-0 w-full text-left overflow-hidden px-1.5 flex items-center gap-1"
      style={{
        backgroundColor: bg,
        borderTop: top ? undefined : '1px dashed rgba(255,255,255,0.55)',
      }}
      title={`${top ? 'Profilaxis' : 'Extra'}: ${cita.servicio.nombre}${tieneSesion ? ` · sesión ${cita.sesionNumero}/${cita.paquetePaciente!.sesionesTotal}` : ''}`}
    >
      <span className="truncate flex-1 min-w-0" style={{ fontSize: '10px', fontWeight: 600, color: '#fff', lineHeight: 1.1 }}>
        {cita.servicio.nombre}
      </span>
      {tieneSesion && (
        <span
          style={{
            width: '15px', height: '15px', flexShrink: 0, borderRadius: '50%', background: '#DC2626',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: 700, color: '#fff', lineHeight: 1,
          }}
        >
          {cita.sesionNumero}
        </span>
      )}
    </button>
  );
}

export function TarjetaCitaCombinada({ principal, secundario, onClick, slotHeight = 40 }: TarjetaCombinadaProps) {
  const slots = principal.duracionMinutos / 30; // el bloque ocupa el slot del ancla (1 h)
  const height = slots * slotHeight - 4;
  const nombrePaciente = `${principal.paciente.nombres} ${principal.paciente.apellidoPaterno}`;

  // El bloque se arrastra COMPLETO: el draggable usa la cita PRINCIPAL como ancla; al soltar,
  // AgendaPage detecta el slotGrupoId y mueve ambas citas atómicamente. Cada mitad sigue siendo
  // clicable (el sensor exige mover 8px para iniciar arrastre, así el clic abre el popover).
  const final = (c: CitaResumen) => c.estado === 'completada' || c.estado === 'cancelada' || c.estado === 'no_show';
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: principal.id,
    data: { cita: principal },
    disabled: final(principal) || final(secundario),
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="cita-card absolute left-1 right-1 overflow-hidden flex flex-col"
      style={{ height: `${height}px`, borderRadius: '6px', transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.5 : 1, zIndex: isDragging ? 50 : 1, touchAction: 'none' }}
      aria-label={`Bloque combinado de ${nombrePaciente}`}
    >
      {/* Cabecera compacta: paciente (una vez) + indicador de bloque */}
      <div className="flex items-center gap-1 px-1.5 bg-slate-800/90 shrink-0" style={{ height: '15px' }}>
        <RomboAlerta alerta={principal.paciente.alerta} size={8} />
        <span className="truncate font-semibold flex-1 min-w-0" style={{ fontSize: '9px', color: '#fff', lineHeight: 1 }}>{nombrePaciente}</span>
        <span title="Bloque combinado (2 servicios en 1 turno)" style={{ fontSize: '8px' }}>🔗</span>
      </div>
      {/* Dos mitades clicables, cada una una línea limpia */}
      <MitadCita cita={principal} onClick={onClick} top />
      <MitadCita cita={secundario} onClick={onClick} top={false} />
    </div>
  );
}
