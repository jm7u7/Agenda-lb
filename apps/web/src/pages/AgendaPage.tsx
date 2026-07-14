import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  closestCenter,
} from '@dnd-kit/core';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

import { horaInicioValidaParaDuracion, timeToMinutes, esCitaInactiva } from '@limablue/shared';
import { useAgendaStore } from '../stores/agendaStore';
import { sedesApi, profesionalesApi, horariosApi, type Sede } from '../api';
import { citasApi, type CitaResumen } from '../api/citas';
import { almuerzosApi } from '../api/almuerzos';
import { permisosApi } from '../api/permisos';
import { useSocket } from '../hooks/useSocket';

import { HeaderAgenda } from '../components/agenda/HeaderAgenda';
import { EjeHoras } from '../components/agenda/EjeHoras';
import { ColumnaAgenda } from '../components/agenda/ColumnaAgenda';
import { TarjetaCita } from '../components/agenda/TarjetaCita';
import { DrawerNuevaCita } from '../components/agenda/DrawerNuevaCita';
import { PopoverCita } from '../components/agenda/PopoverCita';
import { ModalBuscador } from '../components/agenda/ModalBuscador';
import { AgendaSkeleton } from '../components/ui/Skeleton';
import { cn } from '../utils/cn';

export function AgendaPage() {
  const { sedeId, setSedeId, fecha, setFecha, unidadNegocioId, setUnidadNegocioId, fechaStr } = useAgendaStore();
  const qc = useQueryClient();
  const [draggingCita, setDraggingCita] = useState<CitaResumen | null>(null);
  const [citaSeleccionada, setCitaSeleccionada] = useState<CitaResumen | null>(null);
  const [drawerState, setDrawerState] = useState<{ hora?: string; profesionalId?: string } | null>(null);
  const [modoBuscador, setModoBuscador] = useState<'documento' | 'nombre' | null>(null);
  const [horaActual, setHoraActual] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setHoraActual(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Cargar sedes
  const { data: sedes } = useQuery({
    queryKey: ['sedes'],
    queryFn: sedesApi.listar,
  });

  // Auto-seleccionar primera sede
  useEffect(() => {
    if (sedes && sedes.length > 0 && !sedeId) {
      setSedeId(sedes[0].id);
    }
  }, [sedes, sedeId, setSedeId]);

  // Cambio de sede con tecla 1-5
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ index: number }>;
      const sede = sedes?.[ev.detail.index];
      if (sede) setSedeId(sede.id);
    };
    document.addEventListener('agenda:sede', handler);
    return () => document.removeEventListener('agenda:sede', handler);
  }, [sedes, setSedeId]);

  // Nueva cita con tecla N
  useEffect(() => {
    const handler = () => setDrawerState({});
    document.addEventListener('agenda:nueva-cita', handler);
    return () => document.removeEventListener('agenda:nueva-cita', handler);
  }, []);

  const sedeActual = sedes?.find(s => s.id === sedeId);

  // Auto-seleccionar primera unidad de negocio de la sede
  useEffect(() => {
    if (sedeActual && sedeActual.unidadesNegocio.length > 0) {
      if (!unidadNegocioId || !sedeActual.unidadesNegocio.find(u => u.id === unidadNegocioId)) {
        setUnidadNegocioId(sedeActual.unidadesNegocio[0].id);
      }
    }
  }, [sedeActual, unidadNegocioId, setUnidadNegocioId]);

  const unidadActual = sedeActual?.unidadesNegocio.find(u => u.id === unidadNegocioId);

  // Socket.io tiempo real
  useSocket(sedeId);

  // Cargar profesionales
  const { data: profesionales } = useQuery({
    queryKey: ['profesionales-sede', sedeId, unidadNegocioId, fechaStr()],
    queryFn: () => profesionalesApi.listar({
      sedeId: sedeId!,
      unidadNegocioId: unidadNegocioId!,
      fecha: fechaStr(),
      activo: true,
    }),
    enabled: !!sedeId && !!unidadNegocioId,
  });

  // Cargar citas
  const { data: citas, isLoading: citasLoading } = useQuery({
    queryKey: ['citas', sedeId, fechaStr(), unidadNegocioId],
    queryFn: () => citasApi.listar({
      sedeId: sedeId!,
      fecha: fechaStr(),
      unidadNegocioId: unidadNegocioId!,
    }),
    enabled: !!sedeId && !!unidadNegocioId,
    refetchInterval: 60_000,
  });

  // Citas de TODAS las unidades de la sede ese día — para bloquear visualmente el
  // slot de una persona que está ocupada en otra unidad (p.ej. Daniel en Baropodometría
  // bloquea su columna de Podología). Una persona no puede estar en dos lados a la vez.
  // Prefijo 'citas' A PROPÓSITO: así CUALQUIER invalidateQueries(['citas']) (crear/mover/estado/
  // cancelar cita, en drawer/popover/socket) refresca también esta ocupación cruzada al instante.
  // Antes la clave era ['citas-ocupacion',…] y NADIE la invalidaba → la franja "Ocupado" de otra
  // unidad quedaba desactualizada hasta 60 s (p.ej. baro de Daniel no bloqueaba su podología al toque).
  const { data: citasSedeTodas = [] } = useQuery({
    queryKey: ['citas', 'ocupacion', sedeId, fechaStr()],
    queryFn: () => citasApi.listar({ sedeId: sedeId!, fecha: fechaStr() }),
    enabled: !!sedeId,
    refetchInterval: 60_000,
  });

  const ocupacionCruzadaPorProf = useMemo(() => {
    const map = new Map<string, { horaInicio: string; duracionMinutos: number; unidad: string }[]>();
    for (const c of citasSedeTodas) {
      if (c.unidadNegocioId === unidadNegocioId) continue; // las de la unidad actual ya son tarjetas
      if (esCitaInactiva(c.estado)) continue;
      const personas = [c.profesionalId, c.solicitadoProfesional?.id].filter(Boolean) as string[];
      for (const pid of personas) {
        const arr = map.get(pid) ?? [];
        arr.push({ horaInicio: c.horaInicio, duracionMinutos: c.duracionMinutos, unidad: c.unidadNegocio.nombre });
        map.set(pid, arr);
      }
    }
    return map;
  }, [citasSedeTodas, unidadNegocioId]);

  // Bloqueos de almuerzo de la sede en la fecha actual
  const { data: bloqueosAgenda = [] } = useQuery({
    queryKey: ['bloqueos-almuerzo', sedeId, fechaStr()],
    queryFn: () => almuerzosApi.listarPorFecha(sedeId!, fechaStr()),
    enabled: !!sedeId,
    staleTime: 5 * 60 * 1000,
  });

  // Permisos / bloqueos manuales de la sede en la fecha actual
  const { data: permisosAgenda = [] } = useQuery({
    queryKey: ['permisos-agenda', sedeId, fechaStr()],
    queryFn: () => permisosApi.listarPorFecha(sedeId!, fechaStr()),
    enabled: !!sedeId,
    staleTime: 60 * 1000,
  });

  // Orden de columnas (SOLO front): quien HOY no atiende (sin turno) o está de vacaciones todo el
  // día se va al FINAL, a la derecha. Sort estable → conserva el orden previo dentro de cada grupo.
  const columnasOrdenadas = useMemo(() => {
    const lista = profesionales ?? [];
    const enVacaciones = (id: string) => permisosAgenda.some(p => p.profesionalId === id && p.esVacaciones);
    const inactivoHoy = (p: (typeof lista)[number]) => (!p.horaEntrada && !p.horaSalida) || enVacaciones(p.id);
    return [...lista].sort((a, b) => Number(inactivoHoy(a)) - Number(inactivoHoy(b)));
  }, [profesionales, permisosAgenda]);

  // Stats del día
  const { data: stats } = useQuery({
    queryKey: ['stats', sedeId, fechaStr()],
    queryFn: () => citasApi.stats(sedeId!, fechaStr()),
    enabled: !!sedeId,
  });

  // Horario efectivo de la sede ese día → define el rango horario de la grilla.
  const { data: horarioData } = useQuery({
    queryKey: ['horario', sedeId, fechaStr()],
    queryFn: () => horariosApi.efectivo(sedeId!, fechaStr()),
    enabled: !!sedeId,
  });
  const ef = horarioData?.efectivo;
  let aperturaGrid = (ef && ef.abierto && ef.apertura) ? ef.apertura : '08:00';
  let cierreGrid = (ef && ef.abierto && ef.cierre) ? ef.cierre : '20:00';
  // Defensa: un rango inválido (apertura ≥ cierre, p.ej. excepción mal guardada)
  // dejaría la grilla VACÍA. En ese caso se usa el rango por defecto para que la
  // agenda y las citas SIEMPRE se vean.
  if (timeToMinutes(aperturaGrid) >= timeToMinutes(cierreGrid)) {
    aperturaGrid = '08:00';
    cierreGrid = '20:00';
  }
  const aperturaMin = timeToMinutes(aperturaGrid);
  const cierreMin = timeToMinutes(cierreGrid);

  // Auto-completar citas en estado "llego" pasados 90 minutos de su horaInicio
  useEffect(() => {
    const autoCompletar = () => {
      if (!citas) return;
      const ahora = new Date();
      const fechaAgenda = fechaStr(); // solo aplica al día visible
      // "Hoy" en hora LOCAL (Lima): con toISOString (UTC) a partir de las 19:00 ya era
      // "mañana" y el auto-completado dejaba de correr la última parte del día.
      const hoy = format(new Date(), 'yyyy-MM-dd');
      if (fechaAgenda !== hoy) return; // solo en el día de hoy

      const citasParaCompletar = citas.filter(c => {
        if (c.estado !== 'llego') return false;
        const [hh, mm] = c.horaInicio.split(':').map(Number);
        const inicioMs = new Date(fechaAgenda + 'T12:00:00').setHours(hh ?? 0, mm ?? 0, 0, 0);
        return (ahora.getTime() - inicioMs) / 60_000 >= 90;
      });
      if (citasParaCompletar.length === 0) return;
      // Auto-completado SILENCIOSO: completa las citas pasados 90 min de la llegada y refresca,
      // sin mostrar ninguna notificación (la función queda activa, el aviso se elimina).
      Promise.allSettled(citasParaCompletar.map(c => citasApi.cambiarEstado(c.id, 'completada')))
        .then(() => qc.invalidateQueries({ queryKey: ['citas'] }))
        .catch(() => {});
    };

    autoCompletar(); // ejecutar al cargar
    const intervalo = setInterval(autoCompletar, 60_000); // cada minuto
    return () => clearInterval(intervalo);
  }, [citas, fechaStr, qc]);

  // Mover cita
  const moverMutation = useMutation({
    // Si la cita pertenece a un bloque combinado (slotGrupoId), se mueve el GRUPO completo
    // (ambas citas) de forma atómica; si no, solo esa cita.
    mutationFn: ({ citaId, slotGrupoId, profesionalId, fecha, horaInicio, origenAsignacion }: { citaId: string; slotGrupoId?: string | null; profesionalId: string; fecha: string; horaInicio: string; origenAsignacion?: string }) =>
      slotGrupoId
        ? citasApi.moverGrupo(slotGrupoId, { profesionalId, fecha, horaInicio, origenAsignacion })
        : citasApi.mover(citaId, { profesionalId, fecha, horaInicio, origenAsignacion }),
    onSuccess: (citaActualizada) => {
      qc.invalidateQueries({ queryKey: ['citas'] });
      const nombre = `${citaActualizada.paciente.nombres} ${citaActualizada.paciente.apellidoPaterno}`;
      toast.success(`Cita de ${nombre} movida correctamente`, { duration: 3000 });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const cita = (event.active.data.current as { cita: CitaResumen })?.cita;
    if (cita) setDraggingCita(cita);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setDraggingCita(null);
    const { active, over } = event;
    if (!over || !draggingCita) return;

    const [nuevoProfesionalId, nuevaHora] = (over.id as string).split('::');
    if (!nuevoProfesionalId || !nuevaHora) return;

    // No mover si es el mismo slot
    if (draggingCita.profesionalId === nuevoProfesionalId && draggingCita.horaInicio === nuevaHora) return;

    // Servicios de 1 hora solo en hora entera
    if (!horaInicioValidaParaDuracion(nuevaHora, draggingCita.duracionMinutos)) {
      toast.error('Los servicios de 1 hora solo pueden iniciarse en hora entera (08:00, 09:00, …)');
      return;
    }

    // Una cita larga (60 min) puede caer en un slot libre pero PISAR la siguiente media
    // hora ya ocupada. El backend igual lo rechaza; aquí se avisa con un mensaje claro
    // antes de llamar a la API.
    if (draggingCita.duracionMinutos > 30 && citas) {
      const ini = timeToMinutes(nuevaHora);
      const fin = ini + draggingCita.duracionMinutos;
      const grupoIds = draggingCita.slotGrupoId
        ? citas.filter(c => c.slotGrupoId === draggingCita.slotGrupoId).map(c => c.id)
        : [draggingCita.id];
      const choque = citas.find(c =>
        c.profesionalId === nuevoProfesionalId &&
        !grupoIds.includes(c.id) &&
        !esCitaInactiva(c.estado) &&
        timeToMinutes(c.horaInicio) < fin &&
        timeToMinutes(c.horaInicio) + c.duracionMinutos > ini,
      );
      if (choque) {
        toast.error(`No cabe ahí: chocaría con la cita de las ${choque.horaInicio}. Elige un espacio de ${draggingCita.duracionMinutos} min libres.`);
        return;
      }
    }

    // Advertir si el paciente eligió el profesional y se está cambiando
    if (draggingCita.origenAsignacion === 'elegida_por_paciente' && draggingCita.profesionalId !== nuevoProfesionalId) {
      const profDestino = profesionales?.find(p => p.id === nuevoProfesionalId);
      const nombreProf = profDestino ? `${profDestino.nombres} ${profDestino.apellidos}` : 'nueva profesional';
      const confirmed = window.confirm(
        `⚠️ El paciente eligió expresamente a ${draggingCita.profesional?.nombres} ${draggingCita.profesional?.apellidos}.\n\n¿Mover a ${nombreProf} a las ${nuevaHora}?`
      );
      if (!confirmed) return;
    }

    // Si el profesional cambió, la recepcionista está eligiendo uno específico = elegida_por_paciente.
    // Si solo cambia la hora sin cambiar profesional, es un ajuste operativo = asignada_automaticamente.
    const profesionalCambio = draggingCita.profesionalId !== nuevoProfesionalId;
    moverMutation.mutate({
      citaId: draggingCita.id,
      slotGrupoId: draggingCita.slotGrupoId, // bloque combinado → mueve ambas citas
      profesionalId: nuevoProfesionalId,
      fecha: fechaStr(),
      horaInicio: nuevaHora,
      origenAsignacion: profesionalCambio ? 'elegida_por_paciente' : 'asignada_automaticamente',
    });
  }, [draggingCita, fechaStr, moverMutation, profesionales, citas]);

  const handleSlotClick = useCallback((hora: string, profesional: { id: string }) => {
    setDrawerState({ hora, profesionalId: profesional.id });
  }, []);

  const handleCitaClick = useCallback((cita: CitaResumen) => {
    setCitaSeleccionada(cita);
  }, []);

  if (!sedes) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-limablue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-slate-500">Cargando agenda...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <HeaderAgenda sedes={sedes} stats={stats} />

      {/* Tabs de unidad de negocio */}
      {sedeActual && (
        <div className="flex items-center gap-0 px-4 bg-white border-b border-slate-200">
          {sedeActual.unidadesNegocio.map(unidad => (
            <button
              key={unidad.id}
              onClick={() => setUnidadNegocioId(unidad.id)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium border-b-2 transition-all',
                unidadNegocioId === unidad.id
                  ? 'border-limablue-600 text-limablue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              )}
            >
              {unidad.nombre}
            </button>
          ))}

          <div className="flex-1" />

          {/* Buscadores */}
          <div className="flex items-center gap-1.5 mr-3">
            <button
              onClick={() => setModoBuscador('documento')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
              </svg>
              DNI / Documento
            </button>
            <button
              onClick={() => setModoBuscador('nombre')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Buscar nombre
            </button>
          </div>

          {/* Botón nueva cita */}
          <button
            onClick={() => setDrawerState({})}
            className="btn-primary btn-sm mr-2"
            data-testid="btn-nueva-cita"
          >
            + Nueva cita
          </button>
        </div>
      )}

      {/* Leyenda de estados */}
      <div className="flex items-center gap-4 px-4 py-1.5 bg-slate-50 border-b border-slate-200 overflow-x-auto shrink-0">
        {[
          { color: '#64748B', label: 'Agendada' },
          { color: '#3B82F6', label: 'Confirmada' },
          { color: '#22C55E', label: 'Llegó' },
          { color: '#F59E0B', label: 'En atención' },
          { color: '#475569', label: 'Completada' },
          { color: '#F87171', label: 'No show' },
          { color: '#94A3B8', label: 'Cancelada' },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1.5 shrink-0">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: color }} />
            <span className="text-xs text-slate-600 whitespace-nowrap">{label}</span>
          </span>
        ))}
      </div>

      {/* Grid de agenda */}
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 overflow-hidden flex">
          {citasLoading || !profesionales ? (
            <AgendaSkeleton />
          ) : profesionales.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-2">
                <p className="text-2xl">🗓</p>
                <p className="text-slate-600 font-medium">No hay profesionales asignados a esta sede</p>
                <p className="text-sm text-slate-400">
                  {format(fecha, "d 'de' MMMM", { locale: es })} · {unidadActual?.nombre}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-auto">
              <div className="flex min-w-max relative" data-testid="agenda-grid">
                {/* Eje de horas pegado a la izquierda al hacer scroll horizontal */}
                <div className="sticky left-0 z-20 bg-white border-r border-slate-200 shrink-0">
                  <EjeHoras apertura={aperturaGrid} cierre={cierreGrid} />
                </div>
                {/* Indicador de hora actual */}
                {fechaStr() === format(new Date(), 'yyyy-MM-dd') && (() => {
                  const h = horaActual.getHours();
                  const m = horaActual.getMinutes();
                  const mins = h * 60 + m;
                  if (mins < aperturaMin || mins > cierreMin) return null;
                  const top = 56 + ((mins - aperturaMin) / 30) * 40;
                  return (
                    <div
                      className="absolute left-0 right-0 z-30 pointer-events-none flex items-center"
                      style={{ top: `${top}px` }}
                    >
                      <div className="w-2 h-2 rounded-full bg-red-400 shrink-0 -translate-y-px" style={{ marginLeft: '48px' }} />
                      <div className="flex-1 h-px bg-red-400 opacity-50" />
                    </div>
                  );
                })()}
                {/* Columnas de profesionales — ancho natural, permiten scroll.
                    Orden: activos primero; los que no atienden hoy o están de vacaciones, al final. */}
                <div className="flex">
                  {columnasOrdenadas.map(prof => {
                    const citasProf = citas?.filter(c => c.profesionalId === prof.id) ?? [];
                    const bloqueosProf = bloqueosAgenda.filter(b => b.profesionalId === prof.id);
                    const permisosProf = permisosAgenda.filter(p => p.profesionalId === prof.id);
                    const ocupacionProf = ocupacionCruzadaPorProf.get(prof.id) ?? [];
                    return (
                      <ColumnaAgenda
                        key={prof.id}
                        profesional={prof}
                        citas={citasProf}
                        bloqueos={bloqueosProf}
                        permisos={permisosProf}
                        ocupacionExterna={ocupacionProf}
                        onSlotClick={handleSlotClick}
                        onCitaClick={handleCitaClick}
                        apertura={aperturaGrid}
                        cierre={cierreGrid}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* DragOverlay */}
        <DragOverlay>
          {draggingCita && (
            <div className="cita-card dragging" style={{ width: 180, height: 36, backgroundColor: '#3B82F6' }}>
              <p className="font-semibold text-xs text-white truncate">
                {draggingCita.paciente.nombres} {draggingCita.paciente.apellidoPaterno}
              </p>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Drawer nueva cita */}
      {drawerState !== null && sedeId && unidadNegocioId && unidadActual && (
        <DrawerNuevaCita
          sedeId={sedeId}
          unidadNegocioId={unidadNegocioId}
          modoReserva={unidadActual.modoReserva}
          fecha={fecha}
          horaInicio={drawerState.hora}
          profesionalId={drawerState.profesionalId}
          onClose={() => setDrawerState(null)}
        />
      )}

      {/* Modal buscador */}
      {modoBuscador && (
        <ModalBuscador
          modoInicial={modoBuscador}
          fechaHoy={format(new Date(), 'yyyy-MM-dd')}
          onClose={() => setModoBuscador(null)}
          onIrAFecha={(fechaStr) => {
            setFecha(new Date(fechaStr + 'T12:00:00'));
            setModoBuscador(null);
          }}
          onVerDetalle={(cita) => setCitaSeleccionada(cita)}
        />
      )}

      {/* Popover detalle cita */}
      {citaSeleccionada && (
        <PopoverCita
          cita={citaSeleccionada}
          onClose={() => setCitaSeleccionada(null)}
          onReprogramar={(cita) => {
            setCitaSeleccionada(null);
            toast('Arrastra la cita al nuevo horario', { icon: '🗓', duration: 4000 });
          }}
        />
      )}
    </div>
  );
}
