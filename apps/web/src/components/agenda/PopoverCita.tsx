import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { citasApi } from '../../api/citas';
import type { CitaResumen } from '../../api/citas';
import { profesionalesApi, pacientesApi, disponibilidadApi, type Profesional, type HistorialCita } from '../../api';
import { BadgeEstado, BadgeSesion } from '../ui/Badge';
import { Avatar } from '../ui/Avatar';
import { format, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '../../utils/cn';
import { useCanales } from '../../hooks/useCanales';
import { usePromociones } from '../../hooks/usePromociones';
import { formatPromoValor } from '../../api/promociones';
import { RomboAlerta } from '../pacientes/RomboAlerta';
import { CuadroFamiliares } from '../pacientes/CuadroFamiliares';
import { ToggleDatosPaciente } from '../pacientes/ToggleDatosPaciente';
import { BadgeAsistencia } from '../pacientes/BadgeAsistencia';
import { BotonHistorialGenexis } from '../pacientes/HistorialGenexis';
import { SaldoPaquetes, DialogoConsumo } from '../pacientes/SaldoPaquetes';
import { usePaquetesPaciente, paquetesElegibles, paquetesOtraSede } from '../../api/paquetesSesiones';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAgendaStore } from '../../stores/agendaStore';
import { generarSlotsDelDia, horaInicioValidaParaDuracion, esCitaInactiva } from '@limablue/shared';

const SLOTS = generarSlotsDelDia('08:00', '20:00', 30);

interface PopoverCitaProps {
  cita: CitaResumen;
  onClose: () => void;
  onReprogramar: (cita: CitaResumen) => void;
}

const ESTADOS_FINALES = ['completada', 'no_show', 'cancelada'];

const CONSULTORIOS_POR_SEDE: Record<string, number> = {
  'Los Olivos': 6,
  'San Miguel': 4,
  'Lince': 9,
  'Paz Soldán': 11,
  'One': 5,
};

function formatFechaCorta(d: Date) {
  return format(d, 'yyyy-MM-dd');
}

export function PopoverCita({ cita, onClose, onReprogramar }: PopoverCitaProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { sedeId, unidadNegocioId } = useAgendaStore();

  const comentarios = cita.comentarios ?? [];
  const [nuevoComentario, setNuevoComentario] = useState('');
  const [editandoComentario, setEditandoComentario] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [motivoCancelacion, setMotivoCancelacion] = useState('');
  const [verHistorial, setVerHistorial] = useState(false);
  const [consultorio, setConsultorioLocal] = useState<number | null>(cita.consultorioNumero ?? null);

  // Panel reprogramar
  const [reprogramando, setReprogramando] = useState(false);
  // Arranca en la FECHA DE LA CITA (no en hoy) para no moverla de día sin querer al reprogramar.
  const [fechaSel, setFechaSel] = useState<Date>(new Date((cita.fecha?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)) + 'T12:00:00'));
  const [horaSel, setHoraSel] = useState<string>(cita.horaInicio);
  const [profSel, setProfSel] = useState<string>(cita.profesionalId ?? '');

  const fechaSelStr = formatFechaCorta(fechaSel);

  const { data: profesionales } = useQuery({
    queryKey: ['profesionales-sede', sedeId, unidadNegocioId, fechaSelStr],
    queryFn: () => profesionalesApi.listar({
      sedeId: sedeId!,
      unidadNegocioId: unidadNegocioId!,
      fecha: fechaSelStr,
      activo: true,
    }),
    enabled: reprogramando && !!sedeId && !!unidadNegocioId,
  });

  // Citas del día/profesional seleccionado para marcar slots ocupados
  const { data: citasDia } = useQuery({
    queryKey: ['citas-reprog', sedeId, fechaSelStr, unidadNegocioId],
    queryFn: () => citasApi.listar({ sedeId: sedeId!, fecha: fechaSelStr, unidadNegocioId: unidadNegocioId! }),
    enabled: reprogramando && !!sedeId && !!unidadNegocioId,
  });

  const { data: datosPaciente, isLoading: loadingHistorial } = useQuery({
    queryKey: ['paciente-historial', cita.paciente.id],
    queryFn: () => pacientesApi.obtener(cita.paciente.id),
    enabled: verHistorial,
    staleTime: 60_000,
  });

  // Saldos de paquetes/membresías (queryKey compartida con ficha y búsqueda).
  const { data: paquetesPac } = usePaquetesPaciente(cita.paciente.id);
  // Diálogo automático SOLO para paquetes nacidos en la Agenda: los de origen
  // GENEXIS no cuentan sesiones en automático — la sesión se ADJUDICA a mano en
  // el desplegable de Nueva Cita (la cita ya viene numerada y consume al llegar).
  const elegiblesConsumo = paquetesElegibles(paquetesPac, cita.servicioId, cita.sedeId, cita.subcategoriaId ?? null, cita.fecha?.slice(0, 10) ?? null)
    .filter((p) => p.origen !== 'GENEXIS_APERTURA');
  const paquetesOtras = paquetesOtraSede(paquetesPac, cita.servicioId, cita.sedeId, cita.subcategoriaId ?? null, cita.fecha?.slice(0, 10) ?? null);
  const [dialogoConsumo, setDialogoConsumo] = useState(false);

  const estadoMutation = useMutation({
    mutationFn: ({ estado, comentario }: { estado: string; comentario?: string }) =>
      citasApi.cambiarEstado(cita.id, estado, comentario, motivoCancelacion || undefined),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['citas'] });
      toast.success('Estado actualizado');
      // Al marcar LLEGADA con paquete elegible: diálogo de consumo de un clic
      // (numeración continua, FIFO). Si no hay elegibles, se cierra normal.
      if (variables.estado === 'llego' && elegiblesConsumo.length > 0) {
        setDialogoConsumo(true);
      } else {
        onClose();
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Canal de reserva — editable inline; guarda al cambiar.
  const { canales: canalesOpts } = useCanales();
  const [canalSel, setCanalSel] = useState(cita.canal);
  const canalMutation = useMutation({
    mutationFn: (canal: string) => citasApi.actualizarCanal(cita.id, canal),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['citas'] }); toast.success('Canal actualizado'); },
    onError: (e: Error) => { setCanalSel(cita.canal); toast.error(e.message); },
  });

  // Promoción — editable solo desde la cita PORTADORA (no SECUNDARIO de un bloque). La
  // secundaria muestra la promo HEREDADA en solo lectura (se edita en la profilaxis).
  const { promociones } = usePromociones();
  const esSecundariaBloque = cita.slotRol === 'SECUNDARIO';
  const promoCita = cita.promocion ?? null;
  const promoHeredada = cita.promocionHeredada ?? null;
  const [promoSel, setPromoSel] = useState(promoCita?.id ?? '');
  const promoMutation = useMutation({
    mutationFn: (promocionId: string | null) => citasApi.actualizarPromocion(cita.id, promocionId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['citas'] }); toast.success('Promoción actualizada'); },
    onError: (e: Error) => { setPromoSel(promoCita?.id ?? ''); toast.error(e.message); },
  });

  // Comentario de recepción — editable en CUALQUIER estado (antes/durante/después). Reemplaza el texto.
  const comentarioMutation = useMutation({
    mutationFn: (texto: string) => citasApi.actualizarComentario(cita.id, texto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['citas'] });
      setEditandoComentario(false);
      setNuevoComentario('');
      toast.success('Comentario agregado');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Autor + hora (America/Lima) de una entrada del hilo.
  const fmtComentario = (creadoEn: string) =>
    new Date(creadoEn).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

  const moverMutation = useMutation({
    mutationFn: () => citasApi.mover(cita.id, {
      profesionalId: profSel,
      fecha: fechaSelStr,
      horaInicio: horaSel,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['citas'] });
      toast.success('Cita reprogramada');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const consultorioMutation = useMutation({
    mutationFn: (num: number | null) => citasApi.actualizarConsultorio(cita.id, num),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['citas'] }),
    // El chip se actualiza optimista al hacer clic: si el guardado falla hay que
    // REVERTIRLO y avisar — antes quedaba pintado un consultorio que nunca se guardó.
    onError: (e: Error) => {
      setConsultorioLocal(cita.consultorioNumero ?? null);
      toast.error(e.message);
    },
  });

  const confirmarMailMutation = useMutation({
    mutationFn: () => citasApi.confirmarPorCorreo(cita.id),
    onSuccess: ({ to }) => {
      qc.invalidateQueries({ queryKey: ['citas'] });
      toast.success(`Correo de confirmación enviado a ${to}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const esFinal = ESTADOS_FINALES.includes(cita.estado);
  const nombrePaciente = `${cita.paciente.nombres} ${cita.paciente.apellidoPaterno} ${cita.paciente.apellidoMaterno}`;
  const iniciales = `${cita.paciente.nombres[0] ?? ''}${cita.paciente.apellidoPaterno[0] ?? ''}`;

  // Slots ocupados del profesional seleccionado en la fecha seleccionada
  const slotsOcupados = new Set<string>();
  if (citasDia && profSel) {
    for (const c of citasDia) {
      if (c.profesionalId === profSel && c.id !== cita.id && !esCitaInactiva(c.estado)) {
        const [hh, mm] = c.horaInicio.split(':').map(Number);
        const start = (hh ?? 0) * 60 + (mm ?? 0);
        for (let m = start; m < start + c.duracionMinutos; m += 30) {
          const slot = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
          slotsOcupados.add(slot);
        }
      }
    }
  }

  // DISPONIBILIDAD REAL del profesional destino (misma fuente que el drawer de nueva
  // cita): descuenta turno, permisos, almuerzos, ocupación en otras unidades y citas.
  // Antes este panel ofrecía una lista fija 08:00–20:00 y el "Confirmar" fallaba (o
  // peor: quedaba una cita fuera del turno). Solo se ofrecen horas realmente agendables.
  const { data: dispoReprog, isFetching: dispoReprogCargando } = useQuery({
    queryKey: ['disponibilidad', cita.sedeId, cita.unidadNegocio?.id, cita.servicio?.id, fechaSelStr, profSel],
    queryFn: () => disponibilidadApi.consultar({
      sede: cita.sedeId,
      unidadNegocio: cita.unidadNegocio!.id,
      servicio: cita.servicio!.id,
      fecha: fechaSelStr,
      profesional: profSel || undefined,
    }),
    enabled: reprogramando && !!profSel && !!cita.unidadNegocio?.id && !!cita.servicio?.id,
  });
  const slotsAgendables = new Set(
    (dispoReprog?.slots ?? []).filter(s => s.disponible).map(s => s.horaInicio),
  );
  // La hora ACTUAL de la cita en su mismo día sigue siendo elegible (es su propio slot).
  if (fechaSelStr === cita.fecha?.slice(0, 10) && profSel === cita.profesionalId) {
    slotsAgendables.add(cita.horaInicio);
  }

  // Próximos 7 días para selección rápida
  const diasRapidos = Array.from({ length: 7 }, (_, i) => addDays(new Date(), i));

  const profActual = cita.profesional
    ? `${cita.profesional.nombres.split(' ')[0]} ${cita.profesional.apellidos.split(' ')[0]}`
    : 'Sin asignar';

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 right-0 top-0 bottom-0 w-[420px] bg-white shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden"
        role="dialog"
        aria-label="Detalle de cita"
        data-testid="popover-cita"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-start gap-3 shrink-0">
          <Avatar iniciales={iniciales} color={cita.profesional?.colorAvatar ?? '#6B7F9E'} size="md" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-900 text-sm leading-tight flex items-center gap-1.5">
              <RomboAlerta alerta={cita.paciente.alerta ?? datosPaciente?.alerta} size={13} />
              <span className="truncate" data-testid="popover-cita-nombre">{nombrePaciente}</span>
            </p>
            <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
              <span>{cita.paciente.telefono}</span>
              {/* Toggle "actualizar datos": estado server-side; clic → edición en la ficha */}
              <ToggleDatosPaciente
                encendido={cita.paciente.requiereActualizacionDatos ?? false}
                contacto={cita.paciente}
                onEditar={() => navigate(`/pacientes/${cita.paciente.id}?editar=datos`)}
              />
            </p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <BadgeEstado estado={cita.estado as never} />
              {/* Asistencia histórica SOLO Limablue — precaución al dar horarios */}
              <BadgeAsistencia alerta={cita.paciente.alerta ?? datosPaciente?.alerta} />
              {cita.paquetePaciente && cita.sesionNumero && (
                <BadgeSesion numero={cita.sesionNumero} total={cita.paquetePaciente.sesionesTotal} />
              )}
              {cita.comprobanteUrl && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                  ✓ Pago registrado
                </span>
              )}
              {cita.estadoConfirmacion === 'confirmada' && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                  ✉️ Confirmada por paciente
                </span>
              )}
              {cita.estadoConfirmacion === 'pendiente' && cita.confirmacionEnviadaEn && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                  ✉️ Correo enviado
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-0.5">✕</button>
        </div>

        {/* Paquetes y membresías activos (chips con semáforo; resaltado = esta cita puede consumir) */}
        {paquetesPac && paquetesPac.some(p => p.estado === 'ACTIVO') && (
          <div className="px-5 py-2 border-b border-slate-100 space-y-1">
            <SaldoPaquetes
              pacienteId={cita.paciente.id}
              variante="chip"
              servicioActualId={cita.servicioId}
              sedeActualId={cita.sedeId}
              onChipClick={() => navigate(`/pacientes/${cita.paciente.id}`)}
            />
            {/* Candado de sede: mismo servicio pero el paquete pertenece a otra sede */}
            {elegiblesConsumo.length === 0 && paquetesOtras.length > 0 && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
                ⚠ El paquete de este paciente pertenece a <b>{paquetesOtras[0].sede?.nombre}</b> — aquí no consume.
              </p>
            )}
          </div>
        )}

        {/* Alerta de paciente de atención (no-show / reprogramador frecuente) */}
        {(() => {
          const al = cita.paciente.alerta ?? datosPaciente?.alerta;
          if (!al?.alerta) return null;
          return (
            <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-200 flex items-start gap-2">
              <RomboAlerta alerta={al} size={14} />
              <div className="text-xs text-amber-800 leading-snug">
                <span className="font-bold">Paciente de atención.</span>{' '}
                {al.frecuenteInasistente && <span>No asiste con frecuencia ({al.noShows} inasistencias). </span>}
                {al.frecuenteReprogramador && <span>Reprograma con frecuencia ({al.reprogramaciones} veces). </span>}
              </div>
            </div>
          );
        })()}

        <div className="flex-1 overflow-y-auto">
          {/* Posibles familiares (mismo teléfono) */}
          {(() => {
            const fam = (cita.paciente.familiares && cita.paciente.familiares.length > 0)
              ? cita.paciente.familiares
              : datosPaciente?.familiares;
            if (!fam || fam.length === 0) return null;
            return (
              <div className="px-5 pt-3">
                <CuadroFamiliares familiares={fam} compacto />
              </div>
            );
          })()}

          {/* Info */}
          <div className="px-5 py-3 border-b border-slate-100 space-y-1.5">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400 w-20 text-xs">Servicio</span>
              <span className="font-medium text-slate-800">{cita.servicio.nombre}</span>
              {cita.subcategoria && (
                <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 text-xxs font-semibold">{cita.subcategoria.nombre}</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400 w-20 text-xs">Hora</span>
              <span className="font-medium text-slate-800">{cita.horaInicio} · {cita.duracionMinutos} min</span>
            </div>

            {/* Profesional — editable */}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400 w-20 text-xs shrink-0">Profesional</span>
              {!esFinal ? (
                <button
                  onClick={() => setReprogramando(v => !v)}
                  className={cn(
                    'flex items-center gap-1.5 px-2 py-0.5 rounded-md text-sm font-medium transition-colors',
                    reprogramando
                      ? 'bg-limablue-50 text-limablue-700 ring-1 ring-limablue-300'
                      : 'text-slate-800 hover:bg-slate-100'
                  )}
                >
                  {profActual}
                  <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
              ) : (
                <span className="font-medium text-slate-800">{profActual}</span>
              )}
            </div>

            {/* Médico solicitado "Solo X" (baropodometría): la cita ocupa una máquina */}
            {cita.solicitadoProfesional && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-400 w-20 text-xs shrink-0">Solicitado</span>
                <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                  🙋 Solo {cita.solicitadoProfesional.tipo === 'medico' ? 'Dr(a). ' : ''}{cita.solicitadoProfesional.nombres} {cita.solicitadoProfesional.apellidos}
                </span>
              </div>
            )}

            {cita.origenAsignacion && !cita.solicitadoProfesional && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-400 w-20 text-xs">Origen</span>
                <span className={cn('text-xs', cita.origenAsignacion === 'elegida_por_paciente' ? 'text-amber-600 font-medium' : 'text-slate-500')}>
                  {cita.origenAsignacion === 'elegida_por_paciente' ? '👤 Eligió la profesional' : '🤖 Asignación automática'}
                </span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400 w-20 text-xs">Canal</span>
              <select
                value={canalSel}
                onChange={e => { setCanalSel(e.target.value); canalMutation.mutate(e.target.value); }}
                disabled={canalMutation.isPending}
                className="text-xs text-slate-700 border border-slate-200 rounded-md px-1.5 py-0.5 bg-white hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-limablue-400"
                title="Canal de reserva — de dónde viene el cliente"
              >
                {!canalesOpts.some(c => c.value === canalSel) && <option value={canalSel}>{canalSel}</option>}
                {canalesOpts.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            {/* Promoción. Editable solo desde la portadora; la secundaria la ve heredada (solo lectura). */}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400 w-20 text-xs">Promoción</span>
              {esSecundariaBloque ? (
                <span className="text-xs text-slate-600" title="Promoción del bloque (se edita en la cita de profilaxis)">
                  {promoHeredada
                    ? <>🎁 {promoHeredada.nombre}{promoHeredada.tipo !== 'OTRO' ? ` · ${formatPromoValor(promoHeredada.tipo, promoHeredada.valor)}` : ''} <span className="text-slate-400">(del bloque)</span></>
                    : <span className="text-slate-400">— Ninguna (del bloque)</span>}
                </span>
              ) : (
                <select
                  value={promoSel}
                  onChange={e => { setPromoSel(e.target.value); promoMutation.mutate(e.target.value || null); }}
                  disabled={promoMutation.isPending}
                  className="text-xs text-slate-700 border border-slate-200 rounded-md px-1.5 py-0.5 bg-white hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-limablue-400 max-w-[12rem]"
                  title="Promoción aplicada a la cita"
                >
                  <option value="">— Ninguna —</option>
                  {promoCita && !promociones.some(p => p.id === promoCita.id) && <option value={promoCita.id}>{promoCita.nombre} (inactiva)</option>}
                  {promociones.map(p => (
                    <option key={p.id} value={p.id}>{p.nombre}{p.tipo !== 'OTRO' ? ` · ${formatPromoValor(p.tipo, p.valor)}` : ''}</option>
                  ))}
                </select>
              )}
            </div>
            {consultorio && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-400 w-20 text-xs">Consultorio</span>
                <span className="font-semibold text-limablue-700 text-xs">Consultorio {consultorio} · {cita.sede.nombre}</span>
              </div>
            )}
          </div>

          {/* ── Confirmación por correo ── */}
          {!esFinal && (
            <div className="px-5 py-3 border-b border-slate-100">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-600">Confirmación por correo</p>
                  <p className="text-xxs text-slate-400 mt-0.5">
                    {cita.estadoConfirmacion === 'confirmada'
                      ? `✓ Confirmada por el paciente${cita.confirmadaEn ? ` · ${format(new Date(cita.confirmadaEn), "d MMM HH:mm", { locale: es })}` : ''}`
                      : cita.estadoConfirmacion === 'cancelada'
                      ? '✕ Cancelada por el paciente'
                      : cita.confirmacionEnviadaEn
                      ? `Correo enviado · ${format(new Date(cita.confirmacionEnviadaEn), "d MMM HH:mm", { locale: es })} · sin respuesta`
                      : 'Aún no se ha enviado'}
                  </p>
                </div>
                <button
                  onClick={() => confirmarMailMutation.mutate()}
                  disabled={confirmarMailMutation.isPending}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-limablue-700 bg-limablue-50 border border-limablue-200 hover:bg-limablue-100 disabled:opacity-50 transition-colors"
                >
                  {confirmarMailMutation.isPending
                    ? 'Enviando…'
                    : '✉️ Reenviar correo'}
                </button>
              </div>
              <p className="text-xxs text-slate-400 mt-1.5">
                El correo se envía automáticamente al agendar. Usa este botón solo si el paciente no lo recibió.
              </p>
            </div>
          )}

          {/* ── Acciones de asistencia (solo estados no finales) ── */}
          {!esFinal && (cita.estado === 'agendada' || cita.estado === 'confirmada' || cita.estado === 'llego' || cita.estado === 'en_atencion') && (
            <div className="px-5 py-3 border-b border-slate-100 space-y-3">
              {(cita.estado === 'agendada' || cita.estado === 'confirmada') && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 mb-2">¿Vino el paciente?</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => estadoMutation.mutate({ estado: 'llego' })}
                      disabled={estadoMutation.isPending}
                      data-testid="popover-cita-btn-llego"
                      className="flex items-center justify-center gap-1.5 py-2 rounded-lg border-2 border-green-300 bg-green-50 text-green-700 font-semibold text-sm hover:bg-green-100 transition-colors"
                    >
                      <span className="text-base">✓</span> Llegó
                    </button>
                    <button
                      onClick={() => estadoMutation.mutate({ estado: 'no_show' })}
                      disabled={estadoMutation.isPending}
                      className="flex items-center justify-center gap-1.5 py-2 rounded-lg border-2 border-red-200 bg-red-50 text-red-600 font-semibold text-sm hover:bg-red-100 transition-colors"
                    >
                      <span className="text-base">✗</span> No vino
                    </button>
                  </div>
                </div>
              )}
              {cita.estado === 'llego' && (
                <button
                  onClick={() => estadoMutation.mutate({ estado: 'en_atencion' })}
                  disabled={estadoMutation.isPending}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border-2 border-amber-300 bg-amber-50 text-amber-700 font-semibold text-sm hover:bg-amber-100 transition-colors"
                >
                  ▶ En atención
                </button>
              )}
              {cita.estado === 'en_atencion' && (
                <button
                  onClick={() => estadoMutation.mutate({ estado: 'completada' })}
                  disabled={estadoMutation.isPending}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border-2 border-emerald-300 bg-emerald-50 text-emerald-700 font-semibold text-sm hover:bg-emerald-100 transition-colors"
                >
                  ✓ Completar atención
                </button>
              )}
            </div>
          )}

          {/* ── Selector de consultorio (todas las citas) ── */}
          {(() => {
            const totalConsultorios = CONSULTORIOS_POR_SEDE[cita.sede.nombre] ?? 0;
            if (totalConsultorios === 0) return null;
            return (
              <div className="px-5 py-3 border-b border-slate-100">
                <p className="text-xs font-semibold text-slate-500 mb-2">
                  Consultorio · <span className="font-normal text-slate-400">{cita.sede.nombre}</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: totalConsultorios }, (_, i) => i + 1).map(n => (
                    <button
                      key={n}
                      onClick={() => {
                        const nuevo = consultorio === n ? null : n;
                        setConsultorioLocal(nuevo);
                        consultorioMutation.mutate(nuevo);
                      }}
                      className={cn(
                        'px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all',
                        consultorio === n
                          ? 'bg-limablue-600 text-white border-limablue-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-limablue-400'
                      )}
                    >
                      C{n}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ── Panel reprogramar ── */}
          {reprogramando && (
            <div className="px-5 py-4 border-b border-limablue-100 bg-limablue-50/40 space-y-4">
              <p className="text-xs font-semibold text-limablue-700 uppercase tracking-wide">Reprogramar cita</p>

              {/* Días rápidos */}
              <div>
                <p className="text-xs text-slate-500 mb-1.5">Fecha</p>
                <div className="flex gap-1.5 flex-wrap">
                  {diasRapidos.map((d, i) => {
                    const isHoy = i === 0;
                    const sel = formatFechaCorta(d) === fechaSelStr;
                    return (
                      <button
                        key={i}
                        onClick={() => setFechaSel(d)}
                        className={cn(
                          'px-2.5 py-1 rounded-lg text-xs font-medium border transition-all',
                          sel
                            ? 'bg-limablue-600 text-white border-limablue-600'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-limablue-400'
                        )}
                      >
                        {isHoy ? 'Hoy' : format(d, 'EEE d', { locale: es })}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-slate-400 mt-1">{format(fechaSel, "EEEE d 'de' MMMM", { locale: es })}</p>
              </div>

              {/* Profesional */}
              <div>
                <p className="text-xs text-slate-500 mb-1.5">Profesional</p>
                {profesionales ? (
                  <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto pr-1">
                    {profesionales
                      .filter(p => p.tipo !== 'medico' || (!p.nombres.startsWith('Baro')))
                      .map((p: Profesional) => {
                        const nombre = `${p.nombres.split(' ')[0]} ${p.apellidos.split(' ')[0]}`;
                        const sel = profSel === p.id;
                        return (
                          <button
                            key={p.id}
                            onClick={() => setProfSel(p.id)}
                            className={cn(
                              'flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs border transition-all text-left',
                              sel
                                ? 'bg-limablue-600 text-white border-limablue-600'
                                : 'bg-white text-slate-700 border-slate-200 hover:border-limablue-400'
                            )}
                          >
                            <span
                              className="w-5 h-5 rounded-full flex items-center justify-center text-white shrink-0"
                              style={{ backgroundColor: p.colorAvatar, fontSize: '9px', fontWeight: 700 }}
                            >
                              {p.nombres[0]}{p.apellidos[0]}
                            </span>
                            <span className="truncate">{nombre}</span>
                          </button>
                        );
                      })}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">Cargando...</p>
                )}
              </div>

              {/* Slots de hora */}
              <div>
                <p className="text-xs text-slate-500 mb-1.5">Hora</p>
                <div className="grid grid-cols-6 gap-1">
                  {/* Servicios de 1 hora: solo se muestran horas enteras (sin :30).
                      "Ocupado" = no está en la disponibilidad real (turno, permisos,
                      almuerzos, citas de cualquier unidad) — misma fuente que el drawer. */}
                  {SLOTS.filter(slot => horaInicioValidaParaDuracion(slot, cita.duracionMinutos)).map(slot => {
                    const ocupado = slotsOcupados.has(slot) || dispoReprogCargando || !slotsAgendables.has(slot);
                    const sel = horaSel === slot;
                    return (
                      <button
                        key={slot}
                        disabled={ocupado}
                        onClick={() => setHoraSel(slot)}
                        className={cn(
                          'py-1 rounded text-xs font-mono transition-all border',
                          sel
                            ? 'bg-limablue-600 text-white border-limablue-600'
                            : ocupado
                            ? 'bg-slate-100 text-slate-300 border-slate-100 cursor-not-allowed line-through'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-limablue-400 hover:text-limablue-600'
                        )}
                      >
                        {slot}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Botones guardar/cancelar */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => moverMutation.mutate()}
                  disabled={moverMutation.isPending || !profSel || !horaSel}
                  className="btn-primary btn-sm flex-1"
                >
                  {moverMutation.isPending ? 'Guardando...' : 'Confirmar cambio'}
                </button>
                <button onClick={() => setReprogramando(false)} className="btn-secondary btn-sm">
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* ── Comprobante de pago ── */}
          {cita.comprobanteUrl && (
            <div className="px-5 py-3 border-b border-slate-100">
              <p className="text-xs font-semibold text-slate-600 mb-2">💳 Comprobante de pago</p>
              <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                {cita.comprobanteMimeType?.startsWith('image/') ? (
                  <img
                    src={cita.comprobanteUrl}
                    alt="comprobante"
                    className="w-14 h-14 object-cover rounded border border-emerald-200 shrink-0"
                  />
                ) : (
                  <div className="w-14 h-14 bg-red-100 rounded border border-red-200 flex items-center justify-center text-2xl shrink-0">
                    📄
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-700 truncate">{cita.comprobanteNombre}</p>
                  {cita.comprobanteSubidoEn && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      {format(new Date(cita.comprobanteSubidoEn), "d MMM yyyy · HH:mm", { locale: es })}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => window.open(cita.comprobanteUrl!, '_blank')}
                  className="text-xs font-medium text-limablue-600 hover:text-limablue-800 transition-colors whitespace-nowrap shrink-0"
                >
                  Abrir ↗
                </button>
              </div>
            </div>
          )}

          {/* Comentarios — hilo append-only (cada entrada con autor y hora) */}
          <div className="px-5 py-3 border-b border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-600">Comentarios</span>
              {!editandoComentario && (
                <button onClick={() => setEditandoComentario(true)} className="text-xs text-limablue-600 hover:underline">
                  + Agregar
                </button>
              )}
            </div>

            {comentarios.length > 0 ? (
              <ul className="space-y-2 mb-2">
                {comentarios.map(c => (
                  <li key={c.id} className="text-sm bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                    <p className="text-slate-700 whitespace-pre-wrap break-words">{c.texto}</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {c.autor?.nombre ?? c.autorEtiqueta ?? 'Sistema'} · {fmtComentario(c.creadoEn)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              !editandoComentario && <p className="text-sm text-slate-400 italic mb-1">Sin comentarios</p>
            )}

            {editandoComentario && (
              <div className="space-y-2">
                <textarea
                  className="input text-sm resize-none w-full"
                  rows={3}
                  placeholder="Escribe un comentario…"
                  value={nuevoComentario}
                  onChange={e => setNuevoComentario(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => comentarioMutation.mutate(nuevoComentario)}
                    disabled={comentarioMutation.isPending || !nuevoComentario.trim()}
                    className="btn-primary btn-sm"
                  >{comentarioMutation.isPending ? 'Agregando…' : 'Agregar'}</button>
                  <button onClick={() => { setNuevoComentario(''); setEditandoComentario(false); }} className="btn-secondary btn-sm">Cancelar</button>
                </div>
              </div>
            )}
          </div>

          {/* Historial Genexis (sistema anterior) — solo se muestra si el paciente tiene historia vieja */}
          <div className="px-5 py-2 border-b border-slate-100 empty:hidden">
            <BotonHistorialGenexis
              pacienteId={cita.paciente.id}
              nombrePaciente={nombrePaciente}
              documento={`${cita.paciente.tipoDocumento ?? ''} ${cita.paciente.numeroDocumento ?? ''}`.trim()}
            />
          </div>

          {/* Historial del paciente */}
          <div className="px-5 py-3 border-b border-slate-100">
            <button
              onClick={() => setVerHistorial(v => !v)}
              className="w-full flex items-center justify-between text-xs font-semibold text-slate-600 hover:text-limablue-700 transition-colors group"
            >
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-slate-400 group-hover:text-limablue-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Historial del paciente
                {datosPaciente && (
                  <span className="ml-1 px-1.5 py-0.5 bg-slate-100 rounded-full text-slate-500 font-normal">
                    {datosPaciente.totalCitas} atenciones
                  </span>
                )}
              </span>
              <svg
                className={cn('w-3.5 h-3.5 text-slate-400 transition-transform', verHistorial && 'rotate-180')}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {verHistorial && (
              <div className="mt-3">
                {loadingHistorial ? (
                  <p className="text-xs text-slate-400 py-2 text-center">Cargando historial...</p>
                ) : datosPaciente?.historial.length === 0 ? (
                  <p className="text-xs text-slate-400 italic py-2 text-center">Sin atenciones previas</p>
                ) : (
                  <>
                  {/* Resumen de servicios — conteo EXACTO sobre todas las citas (backend) */}
                  {datosPaciente && datosPaciente.resumenServicios.length > 0 && (
                    <div className="mb-3 p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
                        Resumen total · {datosPaciente.totalCitas} atenciones
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {datosPaciente.resumenServicios.map(r => (
                          <span
                            key={r.servicioId}
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-slate-200 rounded-full text-[11px] text-slate-700 font-medium"
                          >
                            <span className="text-limablue-600 font-bold">{r.total}</span>
                            {r.nombre}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                    {datosPaciente?.historial.map((h: HistorialCita) => {
                      const esCitaActual = h.id === cita.id;
                      const fecha = new Date(h.fecha.slice(0, 10) + 'T12:00:00');
                      const prof = h.profesional
                        ? `${h.profesional.nombres.split(' ')[0]} ${h.profesional.apellidos.split(' ')[0]}`
                        : '—';
                      const COLORES_ESTADO_H: Record<string, string> = {
                        agendada: 'bg-slate-100 text-slate-600',
                        confirmada: 'bg-blue-100 text-blue-700',
                        llego: 'bg-green-100 text-green-700',
                        en_atencion: 'bg-amber-100 text-amber-700',
                        completada: 'bg-emerald-100 text-emerald-700',
                        no_show: 'bg-red-100 text-red-600',
                        cancelada: 'bg-slate-100 text-slate-400',
                        reprogramada: 'bg-purple-100 text-purple-700',
                      };
                      const estadoClase = COLORES_ESTADO_H[h.estado] ?? 'bg-slate-100 text-slate-500';
                      const LABELS_ESTADO: Record<string, string> = {
                        agendada: 'Agendada', confirmada: 'Confirmada', llego: 'Llegó',
                        en_atencion: 'En atención', completada: 'Completada',
                        no_show: 'No show', cancelada: 'Cancelada', reprogramada: 'Reprog.',
                      };
                      return (
                        <div
                          key={h.id}
                          className={cn(
                            'rounded-lg p-2.5 border text-xs',
                            esCitaActual
                              ? 'border-limablue-300 bg-limablue-50/60'
                              : 'border-slate-100 bg-slate-50/60'
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 font-medium text-slate-800">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: h.servicio.color }}
                              />
                              <span className="truncate max-w-[120px]">{h.servicio.nombre}</span>
                              {h.sesionNumero && (
                                <span className="px-1 py-0.5 bg-black/10 rounded text-[9px] font-bold leading-none">
                                  #{h.sesionNumero}
                                </span>
                              )}
                              {h.slotGrupoId && (
                                <span
                                  title={`Turno combinado · ${h.slotRol === 'PRINCIPAL' ? 'profilaxis (ancla)' : 'servicio extra'} — agendada junto a otra cita en la misma hora`}
                                  className="inline-flex items-center gap-0.5 px-1 py-0.5 bg-violet-100 text-violet-700 rounded text-[9px] font-semibold leading-none shrink-0"
                                >
                                  🔗 {h.slotRol === 'PRINCIPAL' ? 'Combo' : 'Combo·extra'}
                                </span>
                              )}
                            </div>
                            <span className={cn('px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0', estadoClase)}>
                              {LABELS_ESTADO[h.estado] ?? h.estado}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-slate-500">
                            <span>{format(fecha, "d 'de' MMM yyyy", { locale: es })}</span>
                            <span className="text-slate-300">·</span>
                            <span>{h.horaInicio}</span>
                            <span className="text-slate-300">·</span>
                            <span className="truncate">{prof}</span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-1">
                            <span
                              className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: h.sede.color }}
                            />
                            <span className="text-[10px] text-slate-400">{h.sede.nombre}</span>
                          </div>
                          {h.comentarios?.length > 0 && (
                            <p className="mt-1 text-slate-400 italic truncate">{h.comentarios[h.comentarios.length - 1]!.texto}</p>
                          )}
                          {esCitaActual && (
                            <p className="mt-1 text-limablue-500 font-medium text-[10px]">← Esta cita</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  </>
                )}
              </div>
            )}
          </div>


          {/* Cancelar cita */}
          {!esFinal && (
            <div className="px-5 py-3 space-y-2">
              {!cancelando ? (
                <button
                  onClick={() => setCancelando(true)}
                  className="btn btn-sm w-full text-red-500 border border-red-200 hover:bg-red-50"
                >
                  Cancelar cita
                </button>
              ) : (
                <div className="space-y-2 p-3 bg-red-50 rounded-lg border border-red-200">
                  {cita.slotGrupoId && (
                    <p className="text-xs font-semibold text-red-700">
                      🔗 Esta cita es parte de un bloque combinado. Cancelarla cancelará el bloque completo (ambas citas).
                    </p>
                  )}
                  <input
                    className="input text-sm"
                    placeholder="Motivo de cancelación..."
                    value={motivoCancelacion}
                    onChange={e => setMotivoCancelacion(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => estadoMutation.mutate({ estado: 'cancelada' })}
                      disabled={estadoMutation.isPending}
                      className="btn-danger btn-sm flex-1"
                    >
                      Confirmar cancelación
                    </button>
                    <button onClick={() => setCancelando(false)} className="btn-secondary btn-sm">
                      Volver
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 text-xxs text-slate-400 shrink-0">
          Creada: {format(new Date(cita.creadoEn ?? Date.now()), "d/MM/yyyy 'a las' HH:mm", { locale: es })}
          {cita.creadoPorUsuario && <> · por <span className="text-slate-500 font-medium">{cita.creadoPorUsuario.nombre}</span></>}
        </div>
      </div>

      {/* Diálogo de consumo de un clic (tras marcar llegada) */}
      {dialogoConsumo && (
        <DialogoConsumo
          citaId={cita.id}
          pacienteId={cita.paciente.id}
          elegibles={elegiblesConsumo}
          onCerrar={() => { setDialogoConsumo(false); onClose(); }}
        />
      )}
    </>
  );
}
