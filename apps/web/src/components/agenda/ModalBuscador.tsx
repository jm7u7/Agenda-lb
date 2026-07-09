import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { pacientesApi, profesionalesApi, type HistorialCita } from '../../api';
import { citasApi, type CitaResumen } from '../../api/citas';
import { cn } from '../../utils/cn';
import { useAgendaStore } from '../../stores/agendaStore';
import { RomboAlerta } from '../pacientes/RomboAlerta';
import { CuadroFamiliares } from '../pacientes/CuadroFamiliares';

type Modo = 'documento' | 'nombre';

interface ModalBuscadorProps {
  modoInicial: Modo;
  fechaHoy: string; // YYYY-MM-DD
  onClose: () => void;
  onIrAFecha?: (fecha: string) => void; // navega la agenda a esa fecha y cierra el modal
  onVerDetalle?: (cita: CitaResumen) => void; // abre el PopoverCita con el detalle de la cita
}

const COLORES_ESTADO: Record<string, string> = {
  agendada:    'bg-slate-100 text-slate-600',
  confirmada:  'bg-blue-100 text-blue-700',
  llego:       'bg-green-100 text-green-700',
  en_atencion: 'bg-amber-100 text-amber-700',
  completada:  'bg-emerald-100 text-emerald-700',
  no_show:     'bg-red-100 text-red-600',
  cancelada:   'bg-slate-100 text-slate-400',
  reprogramada:'bg-purple-100 text-purple-700',
};

const LABELS_ESTADO: Record<string, string> = {
  agendada: 'Agendada', confirmada: 'Confirmada', llego: 'Llegó',
  en_atencion: 'En atención', completada: 'Completada',
  no_show: 'No show', cancelada: 'Cancelada', reprogramada: 'Reprog.',
};

const ACCION_RAPIDA: Record<string, { estado: string; label: string; colorText: string; colorBorder: string; colorBg: string }> = {
  agendada:   { estado: 'llego',       label: '✓ Llegó',        colorText: '#15803D', colorBorder: '#22C55E', colorBg: '#F0FDF4' },
  confirmada: { estado: 'llego',       label: '✓ Llegó',        colorText: '#15803D', colorBorder: '#22C55E', colorBg: '#F0FDF4' },
  llego:      { estado: 'en_atencion', label: '▶ En atención',  colorText: '#92400E', colorBorder: '#F59E0B', colorBg: '#FFFBEB' },
};

export function ModalBuscador({ modoInicial, fechaHoy, onClose, onIrAFecha, onVerDetalle }: ModalBuscadorProps) {
  const qc = useQueryClient();
  const { sedeId, unidadNegocioId } = useAgendaStore();
  const [modo, setModo] = useState<Modo>(modoInicial);
  const [query, setQuery] = useState('');
  const [busqueda, setBusqueda] = useState(''); // activada para documento (Enter), continua para nombre
  const [pacienteId, setPacienteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Estado edición inline de próxima cita
  const [editandoCitaId, setEditandoCitaId] = useState<string | null>(null);
  const [editFecha, setEditFecha] = useState('');
  const [editHora, setEditHora] = useState('');
  const [editProfId, setEditProfId] = useState('');

  const abrirEdicion = (citaId: string, fecha: string, hora: string, profId: string) => {
    setEditandoCitaId(citaId);
    setEditFecha(fecha.slice(0, 10));
    setEditHora(hora);
    setEditProfId(profId);
  };

  const { data: profesionalesEdit } = useQuery({
    queryKey: ['profesionales-edit', sedeId, unidadNegocioId, editFecha],
    queryFn: () => profesionalesApi.listar({ sedeId: sedeId!, unidadNegocioId: unidadNegocioId!, fecha: editFecha, activo: true }),
    enabled: !!editandoCitaId && !!sedeId && !!unidadNegocioId && !!editFecha,
  });

  const moverMutation = useMutation({
    mutationFn: () => citasApi.mover(editandoCitaId!, { profesionalId: editProfId || null, fecha: editFecha, horaInicio: editHora, origenAsignacion: editProfId ? 'elegida_por_paciente' : 'asignada_automaticamente' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['citas'] });
      qc.invalidateQueries({ queryKey: ['paciente-buscador', pacienteId] });
      setEditandoCitaId(null);
    },
  });

  const cambiarEstado = useMutation({
    mutationFn: ({ citaId, estado }: { citaId: string; estado: string }) =>
      citasApi.cambiarEstado(citaId, estado),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['citas'] });
      qc.invalidateQueries({ queryKey: ['paciente-buscador', pacienteId] });
    },
  });

  // Abrir el detalle (PopoverCita): trae la cita COMPLETA por id y la entrega al padre.
  const [abriendoId, setAbriendoId] = useState<string | null>(null);
  const verDetalle = async (citaId: string) => {
    if (!onVerDetalle) return;
    setAbriendoId(citaId);
    try {
      const cita = await qc.fetchQuery({ queryKey: ['cita', citaId], queryFn: () => citasApi.obtener(citaId), staleTime: 10_000 });
      onVerDetalle(cita);
      onClose();
    } catch {
      setAbriendoId(null);
    }
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, [modo]);

  // Reset al cambiar modo
  const cambiarModo = (m: Modo) => {
    setModo(m);
    setQuery('');
    setBusqueda('');
    setPacienteId(null);
  };

  // Búsqueda de pacientes
  const { data: resultados, isFetching: buscando } = useQuery({
    queryKey: ['buscar-paciente', busqueda],
    queryFn: () => pacientesApi.buscar(busqueda),
    enabled: busqueda.length >= 2,
    staleTime: 30_000,
  });

  // Datos del paciente seleccionado (historial incluye citas de hoy)
  const { data: datosPaciente, isLoading: cargandoPaciente } = useQuery({
    queryKey: ['paciente-buscador', pacienteId],
    queryFn: () => pacientesApi.obtener(pacienteId!),
    enabled: !!pacienteId,
    staleTime: 30_000,
  });

  // Filtra historial para la fecha de hoy
  const citasHoy: HistorialCita[] = (datosPaciente?.historial ?? []).filter(
    (h: HistorialCita) => h.fecha.slice(0, 10) === fechaHoy
  );
  // Citas anteriores (días previos a hoy) — historial de atenciones pasadas
  const citasPasadas: HistorialCita[] = (datosPaciente?.historial ?? []).filter(
    (h: HistorialCita) => h.fecha.slice(0, 10) < fechaHoy
  );

  // Agrupa las citas de hoy: las de un mismo BLOQUE COMBINADO (mismo slotGrupoId,
  // profilaxis + extra en la misma hora) se muestran juntas bajo una tarjeta unificadora.
  const gruposHoy: { key: string; combinado: boolean; citas: HistorialCita[] }[] = [];
  {
    const idxPorGrupo = new Map<string, number>();
    for (const c of citasHoy) {
      if (c.slotGrupoId) {
        const existente = idxPorGrupo.get(c.slotGrupoId);
        if (existente !== undefined) gruposHoy[existente]!.citas.push(c);
        else { idxPorGrupo.set(c.slotGrupoId, gruposHoy.length); gruposHoy.push({ key: c.slotGrupoId, combinado: true, citas: [c] }); }
      } else {
        gruposHoy.push({ key: c.id, combinado: false, citas: [c] });
      }
    }
    // Ordena cada bloque: PRINCIPAL (profilaxis) primero.
    for (const g of gruposHoy) if (g.combinado) g.citas.sort((a, b) => (a.slotRol === 'PRINCIPAL' ? -1 : 1) - (b.slotRol === 'PRINCIPAL' ? -1 : 1));
  }

  const handleInput = (val: string) => {
    setQuery(val);
    setPacienteId(null);
    if (modo === 'nombre') {
      setBusqueda(val); // búsqueda en vivo
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && modo === 'documento') {
      setBusqueda(query.trim());
    }
    if (e.key === 'Escape') onClose();
  };

  const seleccionarPaciente = (id: string) => {
    setPacienteId(id);
  };

  const pacienteActual = resultados?.find(p => p.id === pacienteId);

  // Tarjeta de una cita de hoy (reutilizable: suelta o dentro de un bloque combinado).
  const renderCitaCard = (cita: HistorialCita, enBloque = false) => {
    const estadoClase = COLORES_ESTADO[cita.estado] ?? 'bg-slate-100 text-slate-500';
    const accion = ACCION_RAPIDA[cita.estado];
    const prof = cita.profesional
      ? `${cita.profesional.nombres.split(' ')[0]} ${cita.profesional.apellidos.split(' ')[0]}`
      : 'Sin asignar';
    const cargando = cambiarEstado.isPending && (cambiarEstado.variables as { citaId: string })?.citaId === cita.id;
    return (
      <div key={cita.id} className={cn('rounded-xl overflow-hidden', enBloque ? 'border border-violet-200 bg-white' : 'border border-slate-200')}>
        {/* Franja de color del servicio */}
        <div className="h-1" style={{ backgroundColor: cita.servicio.color }} />
        <div className="p-3 space-y-2">
          {/* Fila servicio + estado */}
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-sm text-slate-800 flex items-center gap-1.5">
              {enBloque && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white shrink-0" style={{ backgroundColor: cita.slotRol === 'PRINCIPAL' ? '#7c3aed' : '#a855f7' }}>
                  {cita.slotRol === 'PRINCIPAL' ? 'Profilaxis' : 'Extra'}
                </span>
              )}
              {cita.servicio.nombre}{cita.subcategoria ? ` · ${cita.subcategoria.nombre}` : ''}
            </p>
            <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium shrink-0', estadoClase)}>
              {LABELS_ESTADO[cita.estado] ?? cita.estado}
            </span>
          </div>

          {/* Hora + duración + profesional */}
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {cita.horaInicio} · {cita.duracionMinutos} min
            </span>
            <span className="text-slate-300">·</span>
            <span>{prof}</span>
            <span className="text-slate-300">·</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white" style={{ backgroundColor: cita.sede.color }}>
              {cita.sede.nombre}
            </span>
          </div>

          {/* Sesión de paquete */}
          {cita.sesionNumero && (
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <span className="w-4 h-4 rounded-full bg-black/15 flex items-center justify-center text-[9px] font-bold text-white">
                {cita.sesionNumero}
              </span>
              <span>Sesión {cita.sesionNumero} del paquete</span>
            </div>
          )}

          {/* Observación/comentario — última entrada del hilo */}
          {cita.comentarios?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <p className="text-xs font-semibold text-amber-700 mb-0.5">Observación</p>
              <p className="text-xs text-amber-800">{cita.comentarios[cita.comentarios.length - 1]!.texto}</p>
            </div>
          )}

          {/* Botón de acción rápida de estado */}
          {accion && (
            <button
              onClick={() => cambiarEstado.mutate({ citaId: cita.id, estado: accion.estado })}
              disabled={cargando}
              className="w-full mt-1 py-1.5 rounded-lg border text-xs font-semibold transition-colors"
              style={{ color: accion.colorText, borderColor: accion.colorBorder, backgroundColor: cargando ? accion.colorBg : 'white' }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = accion.colorBg)}
              onMouseLeave={e => !cargando && (e.currentTarget.style.backgroundColor = 'white')}
            >
              {cargando ? 'Guardando…' : accion.label}
            </button>
          )}

          {/* Ver detalle → abre el PopoverCita con la cita completa */}
          {onVerDetalle && (
            <button
              onClick={() => verDetalle(cita.id)}
              disabled={abriendoId === cita.id}
              className="w-full py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-limablue-600 hover:border-limablue-200 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              {abriendoId === cita.id ? (
                <>
                  <span className="w-3 h-3 border border-limablue-400 border-t-transparent rounded-full animate-spin" />
                  Abriendo…
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  Ver detalle
                </>
              )}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="fixed z-50 inset-0 flex items-start justify-center pt-24 px-4 pointer-events-none">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg pointer-events-auto flex flex-col max-h-[70vh]">

          {/* Header */}
          <div className="px-5 pt-4 pb-3 border-b border-slate-100 shrink-0">
            <div className="flex items-center justify-between mb-3">
              <p className="font-semibold text-slate-800 text-sm">Buscar paciente</p>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
            </div>

            {/* Selector de modo */}
            <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5 mb-3">
              {([
                { id: 'documento', label: 'Por DNI / CE / Pasaporte', icon: '🪪' },
                { id: 'nombre',    label: 'Por nombre',                icon: '🔤' },
              ] as { id: Modo; label: string; icon: string }[]).map(opt => (
                <button
                  key={opt.id}
                  onClick={() => cambiarModo(opt.id)}
                  className={cn(
                    'flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-all',
                    modo === opt.id
                      ? 'bg-white text-limablue-700 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  {opt.icon} {opt.label}
                </button>
              ))}
            </div>

            {/* Input */}
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={inputRef}
                type={modo === 'documento' ? 'text' : 'text'}
                value={query}
                onChange={e => handleInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  modo === 'documento'
                    ? 'Ingresa el número de documento y presiona Enter…'
                    : 'Escribe el nombre del paciente…'
                }
                className="input w-full pl-9 text-sm"
              />
              {modo === 'documento' && (
                <button
                  onClick={() => setBusqueda(query.trim())}
                  className="absolute right-2 top-1/2 -translate-y-1/2 btn-primary btn-sm text-xs px-2"
                >
                  Buscar
                </button>
              )}
              {buscando && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border border-limablue-400 border-t-transparent rounded-full animate-spin" />
              )}
            </div>
          </div>

          {/* Resultados */}
          <div className="flex-1 overflow-y-auto">

            {/* Lista de pacientes (cuando no hay selección) */}
            {!pacienteId && busqueda.length >= 2 && (
              <div className="p-2 space-y-1">
                {resultados?.length === 0 && !buscando && (
                  <p className="text-sm text-slate-400 italic text-center py-4">
                    No se encontraron pacientes con ese {modo === 'documento' ? 'documento' : 'nombre'}
                  </p>
                )}
                {resultados?.map(p => (
                  <button
                    key={p.id}
                    onClick={() => seleccionarPaciente(p.id)}
                    className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-200 flex items-center gap-3"
                  >
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                      style={{ backgroundColor: '#6B7F9E' }}
                    >
                      {p.nombres[0]}{p.apellidoPaterno[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-slate-800 flex items-center gap-1.5">
                        <RomboAlerta alerta={p.alerta} size={12} />
                        <span className="truncate">{p.nombres} {p.apellidoPaterno} {p.apellidoMaterno}</span>
                      </p>
                      <p className="text-xs text-slate-400">{p.numeroDocumento} · {p.telefono}</p>
                    </div>
                    <svg className="w-4 h-4 text-slate-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ))}
              </div>
            )}

            {/* Estado inicial vacío */}
            {!pacienteId && busqueda.length < 2 && (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                <svg className="w-10 h-10 mb-3 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <p className="text-sm">
                  {modo === 'documento'
                    ? 'Ingresa el número de documento'
                    : 'Escribe al menos 2 caracteres del nombre'}
                </p>
              </div>
            )}

            {/* Perfil del paciente seleccionado */}
            {pacienteId && (
              <div className="p-4 space-y-4">
                {/* Volver */}
                <button
                  onClick={() => setPacienteId(null)}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-limablue-600 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Volver a resultados
                </button>

                {cargandoPaciente ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-5 h-5 border-2 border-limablue-400 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <>
                    {/* Cabecera paciente */}
                    <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                      <div
                        className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold shrink-0"
                        style={{ backgroundColor: '#6B7F9E' }}
                      >
                        {pacienteActual?.nombres[0]}{pacienteActual?.apellidoPaterno[0]}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900 flex items-center gap-1.5">
                          <RomboAlerta alerta={pacienteActual?.alerta} size={13} />
                          <span>{pacienteActual?.nombres} {pacienteActual?.apellidoPaterno} {pacienteActual?.apellidoMaterno}</span>
                        </p>
                        <p className="text-xs text-slate-500">
                          {pacienteActual?.numeroDocumento} · {pacienteActual?.telefono}
                        </p>
                      </div>
                    </div>

                    <CuadroFamiliares familiares={pacienteActual?.familiares} compacto />

                    {/* Citas de hoy */}
                    <div>
                      <p className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">
                        Citas de hoy · {format(new Date(fechaHoy + 'T12:00:00'), "d 'de' MMMM", { locale: es })}
                      </p>

                      {citasHoy.length === 0 ? (
                        <div className="text-center py-6 bg-slate-50 rounded-xl border border-slate-100">
                          <p className="text-sm text-slate-400">Sin citas agendadas para hoy</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {gruposHoy.map(grupo => (
                            grupo.combinado ? (
                              /* BLOQUE COMBINADO — dos citas en la misma hora, unificadas */
                              <div key={grupo.key} className="rounded-xl border-2 border-violet-400 overflow-hidden shadow-sm shadow-violet-100">
                                <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white">
                                  <span className="text-sm">🔗</span>
                                  <span className="text-xs font-bold leading-tight">Bloque combinado · {grupo.citas.length} citas en la misma hora</span>
                                  <span className="ml-auto text-xs font-mono font-bold bg-white/20 rounded px-1.5 py-0.5">{grupo.citas[0]!.horaInicio}</span>
                                </div>
                                <div className="p-2 space-y-2 bg-violet-50/50">
                                  {grupo.citas.map(c => renderCitaCard(c, true))}
                                </div>
                              </div>
                            ) : (
                              renderCitaCard(grupo.citas[0]!, false)
                            )
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Próximas citas — solo días DESPUÉS de hoy */}
                    {datosPaciente && datosPaciente.proximas.filter(p => p.fecha.slice(0, 10) > fechaHoy).length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">Próximas citas</p>
                        <div className="space-y-1">
                          {datosPaciente.proximas.filter(p => p.fecha.slice(0, 10) > fechaHoy).map(p => (
                            <div key={p.id} className="rounded-lg border border-slate-200 overflow-hidden">
                              {/* Fila resumen */}
                              <div className="flex items-center gap-2 text-xs text-slate-600 px-3 py-2 bg-slate-50">
                                <span className="font-medium">
                                  {format(new Date(p.fecha.slice(0, 10) + 'T12:00:00'), "d MMM", { locale: es })}
                                </span>
                                <span className="text-slate-300">·</span>
                                <span>{p.horaInicio}</span>
                                <span className="text-slate-300">·</span>
                                <span className="truncate flex-1">{p.servicio.nombre}</span>
                                <span className="flex items-center gap-1 shrink-0">
                                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: p.sede.color }} />
                                  <span className="text-[10px] text-slate-400">{p.sede.nombre}</span>
                                </span>
                                <span className={cn('shrink-0 text-[10px] font-semibold', p.origenAsignacion === 'elegida_por_paciente' ? 'text-amber-600' : 'text-slate-400')}>
                                  {p.origenAsignacion === 'elegida_por_paciente'
                                    ? `Solo ${p.profesional?.nombres?.split(' ')[0] ?? ''}`
                                    : 'CP'}
                                </span>
                                <button
                                  onClick={() => editandoCitaId === p.id ? setEditandoCitaId(null) : abrirEdicion(p.id, p.fecha, p.horaInicio, p.profesional?.id ?? '')}
                                  className={cn(
                                    'shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors',
                                    editandoCitaId === p.id
                                      ? 'bg-slate-200 text-slate-600'
                                      : 'bg-limablue-50 text-limablue-600 hover:bg-limablue-100'
                                  )}
                                >
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                  </svg>
                                  {editandoCitaId === p.id ? 'Cancelar' : 'Editar'}
                                </button>
                              </div>

                              {/* Panel de edición inline */}
                              {editandoCitaId === p.id && (
                                <div className="px-3 py-3 bg-white border-t border-slate-100 space-y-3">
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-[10px] text-slate-500 mb-1">Nueva fecha</label>
                                      <input
                                        type="date"
                                        className="input text-xs w-full"
                                        value={editFecha}
                                        min={fechaHoy}
                                        onChange={e => setEditFecha(e.target.value)}
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] text-slate-500 mb-1">Nueva hora</label>
                                      <input
                                        type="time"
                                        className="input text-xs w-full"
                                        value={editHora}
                                        step={1800}
                                        onChange={e => setEditHora(e.target.value)}
                                      />
                                    </div>
                                  </div>
                                  <div>
                                    <label className="block text-[10px] text-slate-500 mb-1">Profesional</label>
                                    <select
                                      className="input text-xs w-full"
                                      value={editProfId}
                                      onChange={e => setEditProfId(e.target.value)}
                                    >
                                      <option value="">Sin preferencia (CP)</option>
                                      {profesionalesEdit?.map(prof => (
                                        <option key={prof.id} value={prof.id}>
                                          {prof.nombres} {prof.apellidos}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <button
                                    onClick={() => moverMutation.mutate()}
                                    disabled={!editFecha || !editHora || moverMutation.isPending}
                                    className="w-full btn-primary btn-sm"
                                  >
                                    {moverMutation.isPending ? 'Guardando...' : 'Confirmar cambio'}
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Citas anteriores — historial de atenciones pasadas */}
                    {citasPasadas.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">
                          Citas anteriores ({citasPasadas.length})
                        </p>
                        <div className="space-y-1">
                          {citasPasadas.map(c => (
                            <div key={c.id} className="flex items-center gap-2 text-xs text-slate-600 px-3 py-2 bg-slate-50 rounded-lg border border-slate-200">
                              <span className="font-medium">
                                {format(new Date(c.fecha.slice(0, 10) + 'T12:00:00'), "d MMM yyyy", { locale: es })}
                              </span>
                              <span className="text-slate-300">·</span>
                              <span>{c.horaInicio}</span>
                              <span className="text-slate-300">·</span>
                              <span className="truncate flex-1">{c.servicio.nombre}{c.sesionNumero ? ` · sesión ${c.sesionNumero}` : ''}</span>
                              <span className="flex items-center gap-1 shrink-0">
                                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.sede.color }} />
                                <span className="text-[10px] text-slate-400">{c.sede.nombre}</span>
                              </span>
                              <span className={cn('shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-medium', COLORES_ESTADO[c.estado] ?? 'bg-slate-100 text-slate-500')}>
                                {LABELS_ESTADO[c.estado] ?? c.estado}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
