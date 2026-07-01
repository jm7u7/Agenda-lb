import { useDroppable } from '@dnd-kit/core';
import { differenceInCalendarDays, parseISO, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '../../utils/cn';
import { TarjetaCita, TarjetaCitaCombinada } from './TarjetaCita';
import { Avatar } from '../ui/Avatar';
import { agruparCitasPorSlot } from '../../utils/agruparCitas';
import type { CitaResumen } from '../../api/citas';
import type { Profesional } from '../../api';
import type { BloqueoAlmuerzo } from '../../api/almuerzos';
import type { Permiso } from '../../api/permisos';
import { MOTIVO_LABELS } from '../../api/movimientos';
import { generarSlotsDelDia, timeToMinutes, getTurno } from '@limablue/shared';

const SLOT_HEIGHT = 40; // px

interface SlotDroppableProps {
  id: string;
  profesionalId: string;
  hora: string;
  cita?: CitaResumen;
  onSlotClick?: (hora: string) => void;
}

function SlotDroppable({ id, hora, cita, onSlotClick }: SlotDroppableProps) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { hora } });

  if (cita) return null; // El slot con cita es manejado por TarjetaCita

  return (
    <div
      ref={setNodeRef}
      style={{ height: SLOT_HEIGHT }}
      className={cn(
        'agenda-slot transition-colors relative',
        isOver && 'bg-limablue-50 border-l-2 border-limablue-400',
      )}
      onClick={() => onSlotClick?.(hora)}
    >
      <div className="slot-add-btn">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </div>
    </div>
  );
}

// ── Franja visual de almuerzo ─────────────────────────────────────────────────
function FranjaAlmuerzo({ horaInicio, horaFin, slotHeight }: { horaInicio: string; horaFin: string; slotHeight: number }) {
  const turno = getTurno(horaInicio);
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: slotHeight * 2,
        zIndex: 5,
        background: 'repeating-linear-gradient(135deg, #F5F0E8 0px, #F5F0E8 8px, #EDE8DC 8px, #EDE8DC 10px)',
        borderLeft: '3px solid #D4A853',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      <span style={{ fontSize: 14, lineHeight: 1 }}>🍽</span>
      <span style={{ fontSize: 10, fontWeight: 700, color: '#92600A', lineHeight: 1 }}>Almuerzo</span>
      <span style={{ fontSize: 9, color: '#B07D30', lineHeight: 1 }}>{turno?.label ?? `${horaInicio} – ${horaFin}`}</span>
    </div>
  );
}

// ── Franja visual de permiso / bloqueo (rango horario manual) ─────────────────
// Verde = reunión administrativa (Daniel/Yasica); Rojo = permiso que bloquea pacientes.
function FranjaPermiso({ horaInicio, horaFin, motivo, alturaSlots, slotHeight, esReunion = false }: { horaInicio: string; horaFin: string; motivo: string; alturaSlots: number; slotHeight: number; esReunion?: boolean }) {
  const c = esReunion
    ? { bg: 'repeating-linear-gradient(135deg, #DCFCE7 0px, #DCFCE7 8px, #BBF7D0 8px, #BBF7D0 10px)', borde: '#16A34A', titulo: '#166534', sub: '#15803D', icono: '🤝', etiqueta: 'Reunión', tip: 'Reunión' }
    : { bg: 'repeating-linear-gradient(135deg, #FEE2E2 0px, #FEE2E2 8px, #FECACA 8px, #FECACA 10px)', borde: '#E11D48', titulo: '#9F1239', sub: '#BE123C', icono: '🚫', etiqueta: 'Permiso', tip: 'Permiso' };
  return (
    <div
      style={{
        position: 'absolute',
        top: 0, left: 0, right: 0,
        height: slotHeight * alturaSlots,
        zIndex: 5,
        background: c.bg,
        borderLeft: `3px solid ${c.borde}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 2, cursor: 'default', userSelect: 'none', overflow: 'hidden', padding: '0 4px',
      }}
      title={`${c.tip} ${horaInicio}–${horaFin}: ${motivo}`}
    >
      <span style={{ fontSize: 13, lineHeight: 1 }}>{c.icono}</span>
      <span style={{ fontSize: 10, fontWeight: 700, color: c.titulo, lineHeight: 1.1 }}>{c.etiqueta}</span>
      <span style={{ fontSize: 9, color: c.sub, lineHeight: 1.1 }}>{horaInicio} – {horaFin}</span>
      {/* Motivo de la reunión/permiso: visible desde 1 h (2 slots), hasta 2 líneas con ellipsis. */}
      {alturaSlots >= 2 && (
        <span style={{
          fontSize: 9, fontWeight: 600, color: c.titulo, lineHeight: 1.15, textAlign: 'center', maxWidth: '100%',
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: alturaSlots >= 3 ? 3 : 2, WebkitBoxOrient: 'vertical', wordBreak: 'break-word',
        }}>{motivo}</span>
      )}
    </div>
  );
}

interface OcupacionExterna { horaInicio: string; duracionMinutos: number; unidad: string }

interface ColumnaAgendaProps {
  profesional: Profesional;
  citas: CitaResumen[];
  bloqueos?: BloqueoAlmuerzo[];
  permisos?: Permiso[];
  /** Slots donde la persona está ocupada en OTRA unidad (no puede agendarse aquí). */
  ocupacionExterna?: OcupacionExterna[];
  onSlotClick: (hora: string, profesional: Profesional) => void;
  onCitaClick: (cita: CitaResumen) => void;
  /** Apertura/cierre de la sede ese día ("HH:mm"). Por defecto 08:00–20:00. */
  apertura?: string;
  cierre?: string;
}

export function ColumnaAgenda({ profesional, citas, bloqueos = [], permisos = [], ocupacionExterna = [], onSlotClick, onCitaClick, apertura = '08:00', cierre = '20:00' }: ColumnaAgendaProps) {
  const HORAS_DIA = generarSlotsDelDia(apertura, cierre, 30);
  // Mapa slot → ítem (cita individual o bloque combinado). Usa la FUENTE ÚNICA de
  // agrupamiento para que un bloque cuente como UNA unidad de altura (no 2).
  const visibles = citas.filter((c) => !['cancelada', 'no_show'].includes(c.estado));
  const itemPorSlot = new Map<string, ReturnType<typeof agruparCitasPorSlot>[number]>();
  const slotsOcupados = new Set<string>();

  for (const item of agruparCitasPorSlot(visibles)) {
    const repr = item.tipo === 'grupo' ? item.principal : item.cita;
    itemPorSlot.set(repr.horaInicio, item);
    // Marcar sub-slots como ocupados según la duración del representante (1 h en bloques).
    const start = timeToMinutes(repr.horaInicio);
    for (let m = start + 30; m < start + repr.duracionMinutos; m += 30) {
      const h = `${Math.floor(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`;
      slotsOcupados.add(h);
    }
  }

  // Mapa slot → bloqueo de almuerzo; marcar sub-slots del almuerzo
  const bloqueosPorSlot = new Map<string, BloqueoAlmuerzo>();
  const slotsBloqueo = new Set<string>();

  for (const b of bloqueos) {
    if (!b.horaInicio || !b.horaFin) continue;
    bloqueosPorSlot.set(b.horaInicio, b);
    const start = timeToMinutes(b.horaInicio);
    const end = timeToMinutes(b.horaFin);
    for (let m = start + 30; m < end; m += 30) {
      const h = `${Math.floor(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`;
      slotsBloqueo.add(h);
    }
  }

  // Mapa slot → permiso (rango horario manual); marcar sub-slots y altura en slots
  const permisosPorSlot = new Map<string, { permiso: Permiso; alturaSlots: number }>();
  const slotsPermiso = new Set<string>();

  for (const pm of permisos) {
    if (!pm.horaInicio || !pm.horaFin) continue;
    const start = timeToMinutes(pm.horaInicio);
    const end = timeToMinutes(pm.horaFin);
    const alturaSlots = Math.max(1, Math.round((end - start) / 30));
    permisosPorSlot.set(pm.horaInicio, { permiso: pm, alturaSlots });
    for (let m = start + 30; m < end; m += 30) {
      const h = `${Math.floor(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`;
      slotsPermiso.add(h);
    }
  }

  // Mapa slot → ocupación en OTRA unidad (la persona ya está agendada en baro/podología/…).
  // Se pinta como franja "Ocupado" y bloquea el slot para que no se pueda agendar aquí.
  const ocupacionPorSlot = new Map<string, { horaFin: string; alturaSlots: number; unidad: string }>();
  const slotsOcupacionExterna = new Set<string>();
  for (const o of ocupacionExterna) {
    const start = timeToMinutes(o.horaInicio);
    const end = start + o.duracionMinutos;
    const horaFin = `${Math.floor(end / 60).toString().padStart(2, '0')}:${(end % 60).toString().padStart(2, '0')}`;
    const alturaSlots = Math.max(1, Math.round(o.duracionMinutos / 30));
    ocupacionPorSlot.set(o.horaInicio, { horaFin, alturaSlots, unidad: o.unidad });
    for (let m = start + 30; m < end; m += 30) {
      const h = `${Math.floor(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`;
      slotsOcupacionExterna.add(h);
    }
  }

  // Turno del día: horas fuera de [entrada, salida) se bloquean para reservar.
  const entradaMin = profesional.horaEntrada ? timeToMinutes(profesional.horaEntrada) : null;
  const salidaMin = profesional.horaSalida ? timeToMinutes(profesional.horaSalida) : null;
  const fueraDeTurno = (hora: string) => {
    const m = timeToMinutes(hora);
    if (entradaMin != null && m < entradaMin) return true;
    if (salidaMin != null && m >= salidaMin) return true;
    return false;
  };

  const iniciales = `${profesional.nombres[0] ?? ''}${profesional.apellidos[0] ?? ''}`;

  // Badge bajo el nombre cuando la podóloga está en un MOVIMIENTO (no su sede base):
  //  · con fecha de fin → "Hasta el {fecha}" (temporal, cualquier duración).
  //  · indefinido (sin fecha de fin) → el motivo del movimiento (ej. "Cobertura"), porque
  //    es un refuerzo/cobertura sin fecha de regreso. La asignación BASE no muestra nada.
  const badgeVencimiento = (() => {
    const asg = profesional.asignacionActual;
    if (!asg) return null;
    const motivoLabel = asg.motivo ? (MOTIVO_LABELS[asg.motivo as keyof typeof MOTIVO_LABELS] ?? asg.motivo) : null;
    const tooltip = [
      asg.reemplazaProfesional ? `Reemplaza a ${asg.reemplazaProfesional.nombres} ${asg.reemplazaProfesional.apellidos}` : null,
      motivoLabel ? `Motivo: ${motivoLabel}` : null,
    ].filter(Boolean).join(' · ');

    if (asg.fechaFin) {
      const diasRestantes = differenceInCalendarDays(parseISO(asg.fechaFin), new Date());
      if (diasRestantes < 0) return null;
      return { label: `Hasta el ${format(parseISO(asg.fechaFin), "d 'de' MMM", { locale: es })}`, tooltip };
    }
    // Indefinido: solo es badge si es un MOVIMIENTO (no la sede base de la podóloga).
    if (asg.esMovimiento) {
      return { label: motivoLabel ?? 'Refuerzo', tooltip: tooltip || 'Movimiento sin fecha de fin' };
    }
    return null;
  })();

  return (
    <div className="w-44 shrink-0 flex flex-col border-r border-slate-100 last:border-r-0">
      {/* Cabecera */}
      <div className={cn('flex flex-col items-center justify-center gap-0.5 px-2 bg-white border-b border-slate-200 sticky top-0 z-10', badgeVencimiento ? 'h-16 pt-1' : 'h-14')}>
        <Avatar iniciales={iniciales} color={profesional.colorAvatar} size="sm" />
        <p className="text-xxs font-semibold text-slate-700 text-center leading-tight truncate w-full text-center">
          {profesional.nombres.split(' ')[0]} {profesional.apellidos.split(' ')[0]}
        </p>
        {badgeVencimiento && (
          <span
            title={badgeVencimiento.tooltip}
            className="text-[9px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1 leading-tight cursor-help"
          >
            {badgeVencimiento.label}
          </span>
        )}
      </div>

      {/* Slots */}
      <div className="relative flex-1">
        {HORAS_DIA.map(hora => {
          // Sub-slot de cita (multi-slot): renderizar vacío
          if (slotsOcupados.has(hora)) {
            return <div key={hora} style={{ height: SLOT_HEIGHT }} className="agenda-slot" />;
          }

          // Sub-slot de almuerzo: renderizar vacío
          if (slotsBloqueo.has(hora)) {
            return <div key={hora} style={{ height: SLOT_HEIGHT }} className="agenda-slot bg-[#F5F0E8]" />;
          }

          // Sub-slot de permiso: renderizar vacío con tinte rojo
          if (slotsPermiso.has(hora)) {
            return <div key={hora} style={{ height: SLOT_HEIGHT }} className="agenda-slot bg-[#FEE2E2]" />;
          }

          // Sub-slot de ocupación en otra unidad: vacío con tinte gris (bloqueado)
          if (slotsOcupacionExterna.has(hora) && !itemPorSlot.has(hora)) {
            return <div key={hora} style={{ height: SLOT_HEIGHT }} className="agenda-slot bg-slate-100" />;
          }

          const item = itemPorSlot.get(hora);
          const cita = item?.tipo === 'individual' ? item.cita : undefined;
          const hayCita = !!item;
          const bloqueo = bloqueosPorSlot.get(hora);
          const permiso = permisosPorSlot.get(hora);
          const ocupacion = ocupacionPorSlot.get(hora);

          // Inicio de un permiso: franja roja que cubre su rango
          if (permiso && !hayCita) {
            return (
              <div key={hora} style={{ height: SLOT_HEIGHT }} className="relative">
                <FranjaPermiso
                  horaInicio={permiso.permiso.horaInicio ?? hora}
                  horaFin={permiso.permiso.horaFin ?? hora}
                  motivo={permiso.permiso.motivo}
                  alturaSlots={permiso.alturaSlots}
                  slotHeight={SLOT_HEIGHT}
                  esReunion={permiso.permiso.esReunion ?? false}
                />
              </div>
            );
          }

          // Inicio de una ocupación en OTRA unidad: franja gris "Ocupado · {unidad}".
          if (ocupacion && !hayCita && !permiso) {
            return (
              <div key={hora} style={{ height: SLOT_HEIGHT }} className="relative">
                <div
                  style={{ height: SLOT_HEIGHT * ocupacion.alturaSlots - 3, backgroundImage: 'repeating-linear-gradient(45deg,#e2e8f0 0,#e2e8f0 6px,#cbd5e1 6px,#cbd5e1 8px)' }}
                  className="absolute inset-x-1 top-0.5 rounded-md border border-slate-300 flex flex-col items-center justify-center gap-0.5 text-slate-600 cursor-not-allowed z-10 px-1 text-center"
                  title={`Ocupado en ${ocupacion.unidad} — no se puede agendar a esta hora`}
                >
                  <span className="text-[11px]">🔒</span>
                  <span className="text-[9px] font-semibold leading-tight">Ocupado · {ocupacion.unidad}</span>
                </div>
              </div>
            );
          }

          // Fuera de turno (antes de la entrada o después de la salida): atenuado, no
          // reservable. Se etiqueta UNA vez por tramo para que se entienda por qué está
          // bloqueado (p. ej. la podóloga sale 14:00 aunque la sede cierre 15:00).
          if (!hayCita && !bloqueo && !ocupacion && fueraDeTurno(hora)) {
            const m = timeToMinutes(hora);
            const esFinTurno = salidaMin != null && m === salidaMin;          // primer slot tras la salida
            const esAntesEntrada = entradaMin != null && m === entradaMin - 30; // último slot antes de entrar
            const etiqueta = esFinTurno
              ? `Fin de turno · ${profesional.horaSalida ?? ''}`
              : esAntesEntrada
                ? `Entra ${profesional.horaEntrada ?? ''}`
                : null;
            return (
              <div
                key={hora}
                style={{ height: SLOT_HEIGHT, backgroundImage: 'repeating-linear-gradient(45deg,#f1f5f9 0,#f1f5f9 6px,#e9eef4 6px,#e9eef4 8px)' }}
                className="agenda-slot cursor-not-allowed flex items-center justify-center px-1 text-center"
                title={`Fuera del turno de ${profesional.nombres.split(' ')[0]}${profesional.horaEntrada && profesional.horaSalida ? ` (atiende ${profesional.horaEntrada}–${profesional.horaSalida})` : ''}`}
              >
                {etiqueta && (
                  <span style={{ fontSize: '9px', fontWeight: 600, color: '#94a3b8', lineHeight: 1.1 }}>{etiqueta}</span>
                )}
              </div>
            );
          }

          return (
            <div key={hora} style={{ height: SLOT_HEIGHT }} className="relative">
              {bloqueo ? (
                <FranjaAlmuerzo
                  horaInicio={bloqueo.horaInicio}
                  horaFin={bloqueo.horaFin}
                  slotHeight={SLOT_HEIGHT}
                />
              ) : item?.tipo === 'grupo' ? (
                <TarjetaCitaCombinada
                  principal={item.principal}
                  secundario={item.secundario}
                  onClick={onCitaClick}
                  slotHeight={SLOT_HEIGHT}
                />
              ) : cita ? (
                <TarjetaCita
                  cita={cita}
                  onClick={onCitaClick}
                  slotHeight={SLOT_HEIGHT}
                />
              ) : (
                <SlotDroppable
                  id={`${profesional.id}::${hora}`}
                  profesionalId={profesional.id}
                  hora={hora}
                  onSlotClick={(h) => onSlotClick(h, profesional)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
