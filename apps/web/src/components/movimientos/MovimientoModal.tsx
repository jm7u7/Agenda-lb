import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { cn } from '../../utils/cn';
import { sedesApi, profesionalesApi } from '../../api';
import { movimientosApi, MOTIVO_LABELS, type MotivoMovimiento, type Movimiento, type CitaPendiente, type VerificarCitasResult } from '../../api/movimientos';

interface Props {
  onClose: () => void;
  movimientoEditar?: Movimiento | null;
  /** Sede preseleccionada al crear (ej. desde el botón "+" de una columna del tablero). */
  prefillSedeId?: string;
}

const MOTIVOS = Object.entries(MOTIVO_LABELS) as [MotivoMovimiento, string][];

const ESTADO_BADGE: Record<string, string> = {
  agendada:    'bg-slate-100 text-slate-600',
  confirmada:  'bg-blue-100 text-blue-700',
  llego:       'bg-emerald-100 text-emerald-700',
  en_atencion: 'bg-green-200 text-green-800',
};

const ESTADO_LABEL: Record<string, string> = {
  agendada: 'Agendada', confirmada: 'Confirmada', llego: 'Llegó', en_atencion: 'En atención',
};

// ─── Panel de citas pendientes ────────────────────────────────────────────────

function PanelCitasPendientes({
  verificacion,
  nombreProfesional,
  fechaInicio,
  fechaFin,
  onGestionar,
  gestionando,
}: {
  verificacion: VerificarCitasResult;
  nombreProfesional: string;
  fechaInicio: string;
  fechaFin: string | null;
  onGestionar: (citaId: string, estado: 'cancelada' | 'reprogramada') => Promise<void>;
  gestionando: string | null;
}) {
  const [expandido, setExpandido] = useState(true);
  const [menuId, setMenuId] = useState<string | null>(null);

  const copiarLista = () => {
    const desde = fechaInicio ? format(parseISO(fechaInicio), 'd MMM', { locale: es }) : '';
    const hasta = fechaFin ? format(parseISO(fechaFin), 'd MMM', { locale: es }) : 'indefinido';
    const lineas = [
      `CITAS PENDIENTES — ${nombreProfesional} — ${verificacion.citas[0]?.sede ?? ''} — ${desde} al ${hasta}`,
      '─'.repeat(50),
      ...verificacion.citas.map(c =>
        `${c.fecha.slice(5).replace('-', '/')} ${c.horaInicio}  ${c.paciente.nombreCompleto.padEnd(30)}  ${c.paciente.telefono}  ${c.servicio}`
      ),
      '',
      `Total: ${verificacion.totalCitas} citas`,
    ];
    navigator.clipboard.writeText(lineas.join('\n'));
    toast.success('Lista copiada al portapapeles');
  };

  if (!verificacion.bloqueado) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 flex items-center gap-2">
        <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
        <span className="text-xs font-semibold text-emerald-700">Sin citas en ese período — movimiento disponible</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-red-200 bg-red-50">
      {/* Header */}
      <div className="px-3.5 py-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-red-700 flex items-center gap-1.5">
            <span>⚠</span> {verificacion.totalCitas} cita{verificacion.totalCitas !== 1 ? 's' : ''} activa{verificacion.totalCitas !== 1 ? 's' : ''} en ese período
          </p>
          <p className="text-xs text-red-600 mt-0.5">
            Deben gestionarse antes de confirmar el movimiento de {nombreProfesional}.
          </p>
        </div>
        <button
          onClick={() => setExpandido(v => !v)}
          className="text-xs text-red-600 hover:text-red-800 font-medium whitespace-nowrap shrink-0 flex items-center gap-1"
        >
          {expandido ? '▲' : '▼'} Ver lista ({verificacion.totalCitas})
        </button>
      </div>

      {expandido && (
        <div className="border-t border-red-200">
          {/* Resumen por día */}
          <div className="px-3.5 py-2 flex flex-wrap gap-1.5">
            {verificacion.resumenPorDia.map(d => (
              <span key={d.fecha} className="text-xxs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">
                {format(parseISO(d.fecha), 'EEE d MMM', { locale: es })} ({d.cantidad})
              </span>
            ))}
          </div>

          {/* Tabla de citas */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-t border-red-100">
              <thead>
                <tr className="text-xxs text-red-500 bg-red-100/50">
                  <th className="px-3 py-1.5 text-left font-semibold">Fecha</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Hora</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Paciente</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Teléfono</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Servicio</th>
                  <th className="px-3 py-1.5 text-left font-semibold">Estado</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {verificacion.citas.map(cita => (
                  <FilaCita
                    key={cita.id}
                    cita={cita}
                    menuAbierto={menuId === cita.id}
                    onToggleMenu={() => setMenuId(menuId === cita.id ? null : cita.id)}
                    onGestionar={async (estado) => {
                      setMenuId(null);
                      await onGestionar(cita.id, estado);
                    }}
                    gestionando={gestionando === cita.id}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="px-3.5 py-2.5 border-t border-red-100 flex items-center justify-between gap-2">
            <p className="text-xxs text-red-400 italic">
              Contacta a los pacientes y gestiona sus citas para poder confirmar el movimiento.
            </p>
            <button
              onClick={copiarLista}
              className="text-xxs flex items-center gap-1 text-red-600 hover:text-red-800 font-medium shrink-0"
            >
              📋 Copiar lista
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilaCita({
  cita,
  menuAbierto,
  onToggleMenu,
  onGestionar,
  gestionando,
}: {
  cita: CitaPendiente;
  menuAbierto: boolean;
  onToggleMenu: () => void;
  onGestionar: (estado: 'cancelada' | 'reprogramada') => Promise<void>;
  gestionando: boolean;
}) {
  const copiarTelefono = () => {
    navigator.clipboard.writeText(cita.paciente.telefono);
    toast.success('Teléfono copiado', { duration: 1500 });
  };

  return (
    <tr className="border-b border-red-50 hover:bg-red-50/50">
      <td className="px-3 py-2 whitespace-nowrap text-slate-700">
        {format(parseISO(cita.fecha), 'EEE d MMM', { locale: es })}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-slate-600 font-mono">
        {cita.horaInicio}–{cita.horaFin}
      </td>
      <td className="px-3 py-2 font-semibold text-slate-800 whitespace-nowrap">{cita.paciente.nombreCompleto}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className="flex items-center gap-1">
          <span className="font-mono text-slate-600">{cita.paciente.telefono}</span>
          <button onClick={copiarTelefono} title="Copiar teléfono" className="text-slate-400 hover:text-slate-600">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        </span>
      </td>
      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{cita.servicio}</td>
      <td className="px-3 py-2">
        <span className={cn('px-1.5 py-0.5 rounded-full font-semibold', ESTADO_BADGE[cita.estado] ?? 'bg-slate-100 text-slate-600')}>
          {ESTADO_LABEL[cita.estado] ?? cita.estado}
        </span>
      </td>
      <td className="px-2 py-2 relative">
        {gestionando ? (
          <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin mx-auto" />
        ) : (
          <div className="relative">
            <button onClick={onToggleMenu} className="text-slate-400 hover:text-slate-600 px-1 font-bold text-base leading-none">⋮</button>
            {menuAbierto && (
              <div className="absolute right-0 top-5 bg-white border border-slate-200 rounded-lg shadow-lg z-50 min-w-[160px] py-1">
                <button
                  onClick={() => onGestionar('reprogramada')}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 text-slate-700"
                >
                  Marcar como reagendada
                </button>
                <button
                  onClick={() => onGestionar('cancelada')}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-red-50 text-red-600"
                >
                  Marcar como cancelada
                </button>
                <hr className="my-1 border-slate-100" />
                <a
                  href={`/agenda?sedeId=${encodeURIComponent(cita.sede)}&fecha=${cita.fecha}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-3 py-2 text-xs hover:bg-slate-50 text-slate-500"
                >
                  Ver en agenda ↗
                </a>
              </div>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

// ─── Modal principal ──────────────────────────────────────────────────────────

export function MovimientoModal({ onClose, movimientoEditar, prefillSedeId }: Props) {
  const qc = useQueryClient();
  const esEdicion = !!movimientoEditar;

  const [profesionalId, setProfesionalId] = useState(movimientoEditar?.profesionalId ?? '');
  const [sedeId, setSedeId] = useState(movimientoEditar?.sedeId ?? prefillSedeId ?? '');
  const [fechaInicio, setFechaInicio] = useState(movimientoEditar?.fechaInicio?.slice(0, 10) ?? '');
  const [fechaFin, setFechaFin] = useState(movimientoEditar?.fechaFin?.slice(0, 10) ?? '');
  const [sinFechaFin, setSinFechaFin] = useState(!movimientoEditar?.fechaFin);
  const [motivo, setMotivo] = useState<MotivoMovimiento>(movimientoEditar?.motivo ?? 'OTRO');
  const [reemplazaA, setReemplazaA] = useState(movimientoEditar?.reemplazaA ?? '');
  const [notas, setNotas] = useState(movimientoEditar?.notas ?? '');

  const [preview, setPreview] = useState<Awaited<ReturnType<typeof movimientosApi.preview>> | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [verificacion, setVerificacion] = useState<VerificarCitasResult | null>(null);
  const [gestionandoCitaId, setGestionandoCitaId] = useState<string | null>(null);

  const { data: sedes } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });
  const { data: profesionales } = useQuery({
    queryKey: ['profesionales-todos'],
    queryFn: () => profesionalesApi.listar({ activo: true }),
  });
  const { data: profesionalesSede } = useQuery({
    queryKey: ['profesionales-sede-modal', sedeId, fechaInicio],
    queryFn: () => profesionalesApi.listar({ sedeId, fecha: fechaInicio, activo: true }),
    enabled: !!sedeId && !!fechaInicio,
  });

  // ¿Es la asignación de RETORNO que el sistema crea solo al terminar una cobertura temporal?
  const esRetornoAutomatico = !!movimientoEditar?.esRetorno || !!movimientoEditar?.notas?.startsWith('Retorno automático');

  const profSeleccionado = profesionales?.find(p => p.id === profesionalId);
  const nombreProfesional = profSeleccionado
    ? `${profSeleccionado.nombres.split(' ')[0]} ${profSeleccionado.apellidos.split(' ')[0]}`
    : 'la profesional';

  // Preview + verificar-citas en cadena (preview primero para obtener sedeOrigenId)
  const fetchPreview = useCallback(async () => {
    if (!profesionalId || !sedeId || !fechaInicio || esEdicion) return;
    setPreviewLoading(true);
    try {
      const res = await movimientosApi.preview({
        profesionalId,
        sedeId,
        fechaInicio,
        fechaFin: sinFechaFin ? null : (fechaFin || null),
      });
      setPreview(res);

      // Verificar citas SIEMPRE (la detección ya no depende de la sede de origen:
      // lista todas las citas activas de la podóloga en el período, en cualquier sede).
      const ver = await movimientosApi.verificarCitas({
        profesionalId,
        fechaInicio,
        fechaFin: sinFechaFin ? null : (fechaFin || null),
      });
      setVerificacion(ver);
    } catch {
      setPreview(null);
      setVerificacion(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [profesionalId, sedeId, fechaInicio, fechaFin, sinFechaFin, esEdicion]);

  useEffect(() => {
    const t = setTimeout(fetchPreview, 400);
    return () => clearTimeout(t);
  }, [fetchPreview]);

  const handleGestionarCita = async (citaId: string, estado: 'cancelada' | 'reprogramada') => {
    setGestionandoCitaId(citaId);
    try {
      await movimientosApi.gestionarCita(citaId, {
        estado,
        motivo: estado === 'cancelada' ? 'Gestión previa a movimiento de podóloga' : undefined,
      });
      // Refrescar lista de citas
      const ver = await movimientosApi.verificarCitas({
        profesionalId,
        fechaInicio,
        fechaFin: sinFechaFin ? null : (fechaFin || null),
      });
      setVerificacion(ver);
      toast.success(estado === 'cancelada' ? 'Cita cancelada' : 'Cita marcada como reagendada', { duration: 2000 });
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setGestionandoCitaId(null);
    }
  };

  const crearMutation = useMutation({
    mutationFn: () =>
      movimientosApi.crear({
        profesionalId,
        sedeId,
        fechaInicio,
        fechaFin: sinFechaFin ? null : (fechaFin || null),
        motivo,
        reemplazaA: reemplazaA || null,
        notas: notas || null,
      }),
    onSuccess: (mov) => {
      qc.invalidateQueries({ queryKey: ['movimientos'] });
      qc.invalidateQueries({ queryKey: ['profesionales-sede'] });
      toast.success(`Movimiento guardado. ${nombreProfesional} aparecerá en ${mov.sede.nombre} desde el ${format(new Date(mov.fechaInicio), "d 'de' MMM", { locale: es })}.`);
      onClose();
    },
    onError: async (e: Error & { statusCode?: number; data?: { error: string; sedeOrigenId: string; totalCitas: number } }) => {
      if (e.statusCode === 409 && e.data?.error === 'CITAS_PENDIENTES') {
        // Fallback: cargar panel de citas automáticamente
        try {
          const ver = await movimientosApi.verificarCitas({
            profesionalId,
            fechaInicio,
            fechaFin: sinFechaFin ? null : (fechaFin || null),
          });
          setVerificacion(ver);
        } catch {
          toast.error(`${e.data.totalCitas} citas pendientes deben gestionarse primero`);
        }
        return;
      }
      toast.error(e.message);
    },
  });

  const editarMutation = useMutation({
    mutationFn: () =>
      movimientosApi.editar(movimientoEditar!.id, {
        ...(profesionalId !== movimientoEditar!.profesionalId ? { profesionalId } : {}),
        ...(sedeId !== movimientoEditar!.sedeId ? { sedeId } : {}),
        ...(fechaInicio !== movimientoEditar!.fechaInicio?.slice(0, 10) ? { fechaInicio } : {}),
        fechaFin: sinFechaFin ? null : (fechaFin || null),
        motivo,
        notas: notas || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['movimientos'] });
      qc.invalidateQueries({ queryKey: ['profesionales-sede'] });
      toast.success('Movimiento actualizado');
      onClose();
    },
    onError: async (e: Error & { statusCode?: number; data?: { error: string; totalCitas: number } }) => {
      // Cambiar la sede con citas activas en el período → mostrar el panel para gestionarlas.
      if (e.statusCode === 409 && e.data?.error === 'CITAS_PENDIENTES') {
        try {
          const ver = await movimientosApi.verificarCitas({
            profesionalId,
            fechaInicio,
            fechaFin: sinFechaFin ? null : (fechaFin || null),
          });
          setVerificacion(ver);
          toast.error('Gestiona las citas del período antes de cambiar la sede');
        } catch {
          toast.error(`${e.data.totalCitas} citas pendientes deben gestionarse primero`);
        }
        return;
      }
      toast.error(e.message);
    },
  });

  const hayConflicto = !esEdicion && !!preview?.conflicto;
  const bloqueadoPorCitas = !esEdicion && (verificacion?.bloqueado ?? false);
  const puedeGuardar = profesionalId && sedeId && fechaInicio && motivo && !hayConflicto && !bloqueadoPorCitas;
  const isPending = crearMutation.isPending || editarMutation.isPending;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[95vh] overflow-y-auto">
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10 rounded-t-2xl">
            <div>
              <h2 className="font-bold text-slate-900">{esEdicion ? 'Editar movimiento' : 'Nuevo movimiento'}</h2>
              <p className="text-xs text-slate-500 mt-0.5">Cambio de sede de una podóloga</p>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
          </div>

          <div className="px-6 py-5 space-y-5">
            {/* 1. Podóloga (editable también en edición: el backend recrea el movimiento
                 restaurando el estado previo de la podóloga original) */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Podóloga</label>
              <select
                value={profesionalId}
                onChange={e => setProfesionalId(e.target.value)}
                className="input w-full text-sm"
              >
                <option value="">Seleccionar podóloga...</option>
                {/* Los "Adicional" son fijos de su sede → no aparecen como movibles. */}
                {profesionales?.filter(p => p.nombres.trim().toLowerCase() !== 'adicional').map(p => (
                  <option key={p.id} value={p.id}>
                    {p.nombres} {p.apellidos}
                    {p.sedeActual ? ` — ${p.sedeActual.nombre}` : ' — Sin sede'}
                  </option>
                ))}
              </select>
            </div>

            {/* 2. Sede destino (editable también en edición: el backend valida citas del período) */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Sede destino</label>
              <div className="flex flex-wrap gap-2">
                {sedes?.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSedeId(s.id)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-all',
                      sedeId === s.id
                        ? 'border-limablue-500 bg-limablue-50 text-limablue-700 ring-1 ring-limablue-400'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white',
                    )}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    {s.nombre}
                  </button>
                ))}
              </div>
              {esRetornoAutomatico && (
                <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800 leading-relaxed">
                  ℹ️ Este movimiento es el <strong>retorno automático</strong> que el sistema creó para devolver a la
                  podóloga a su sede matriz al terminar una cobertura temporal — no lo creaste tú. Si quieres que al
                  terminar continúe en OTRA sede, cambia aquí la sede destino y guarda.
                </div>
              )}
            </div>

            {/* 3 & 4. Fechas */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Fecha inicio</label>
                <input
                  type="date"
                  value={fechaInicio}
                  onChange={e => setFechaInicio(e.target.value)}
                  className="input w-full text-sm"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-600">Fecha fin</label>
                  <button
                    type="button"
                    onClick={() => setSinFechaFin(v => !v)}
                    className={cn(
                      'text-[10px] font-medium px-1.5 py-0.5 rounded border transition-colors',
                      sinFechaFin
                        ? 'bg-limablue-100 text-limablue-700 border-limablue-300'
                        : 'bg-slate-100 text-slate-500 border-slate-200',
                    )}
                  >
                    Sin fecha fin
                  </button>
                </div>
                <input
                  type="date"
                  value={fechaFin}
                  onChange={e => setFechaFin(e.target.value)}
                  disabled={sinFechaFin}
                  min={fechaInicio}
                  className="input w-full text-sm disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>
            </div>

            {/* 5. Motivo */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Motivo</label>
              <div className="flex flex-wrap gap-2">
                {MOTIVOS.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMotivo(key)}
                    className={cn(
                      'px-2.5 py-1 rounded-lg border text-xs font-medium transition-all',
                      motivo === key
                        ? 'bg-slate-800 text-white border-slate-800'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 6. Reemplaza a */}
            {!esEdicion && sedeId && fechaInicio && (
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Reemplaza a <span className="font-normal text-slate-400">(opcional)</span>
                </label>
                <select
                  value={reemplazaA}
                  onChange={e => setReemplazaA(e.target.value)}
                  className="input w-full text-sm"
                >
                  <option value="">Sin reemplazo específico</option>
                  {profesionalesSede
                    ?.filter(p => p.id !== profesionalId)
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {p.nombres} {p.apellidos}
                      </option>
                    ))}
                </select>
              </div>
            )}

            {/* 7. Notas */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                Notas <span className="font-normal text-slate-400">(visible para recepcionistas)</span>
              </label>
              <textarea
                value={notas}
                onChange={e => setNotas(e.target.value)}
                rows={2}
                placeholder="Esta información será visible para la recepcionista de la sede"
                className="input w-full text-sm resize-none"
              />
            </div>

            {/* Preview de movimiento */}
            {!esEdicion && (profesionalId || sedeId || fechaInicio) && (
              <div className={cn(
                'rounded-xl border p-3.5 text-sm transition-all',
                previewLoading ? 'border-slate-200 bg-slate-50' :
                (preview?.conflicto || bloqueadoPorCitas) ? 'border-red-200 bg-red-50' :
                (preview && verificacion) ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50',
              )}>
                {previewLoading ? (
                  <div className="flex items-center gap-2 text-slate-500">
                    <span className="w-3.5 h-3.5 border-2 border-slate-400/40 border-t-slate-500 rounded-full animate-spin shrink-0" />
                    Calculando impacto…
                  </div>
                ) : preview?.conflicto ? (
                  <div className="space-y-1">
                    <p className="font-semibold text-red-700 text-xs flex items-center gap-1.5">
                      <span>⚠</span> Conflicto detectado
                    </p>
                    <p className="text-red-600 text-xs">{preview.conflicto.mensaje}</p>
                  </div>
                ) : bloqueadoPorCitas ? (
                  <div className="space-y-1">
                    <p className="font-semibold text-red-700 text-xs flex items-center gap-1.5">
                      <span>⚠</span> Movimiento bloqueado
                    </p>
                    <p className="text-red-600 text-xs leading-relaxed">
                      {preview?.descripcion} Hay {verificacion!.totalCitas} cita{verificacion!.totalCitas !== 1 ? 's' : ''} activa{verificacion!.totalCitas !== 1 ? 's' : ''} que deben gestionarse primero.
                    </p>
                  </div>
                ) : preview && verificacion ? (
                  <div className="space-y-1">
                    <p className="font-semibold text-emerald-700 text-xs flex items-center gap-1.5">
                      <span>✓</span> Sin conflictos
                    </p>
                    <p className="text-emerald-800 text-xs leading-relaxed">{preview.descripcion}</p>
                  </div>
                ) : (
                  <p className="text-slate-400 text-xs">Completa podóloga, sede y fecha de inicio para ver el impacto.</p>
                )}
              </div>
            )}

            {/* Panel de citas pendientes (en edición aparece si el cambio de sede fue rechazado) */}
            {verificacion && (
              <PanelCitasPendientes
                verificacion={verificacion}
                nombreProfesional={nombreProfesional}
                fechaInicio={fechaInicio}
                fechaFin={sinFechaFin ? null : fechaFin || null}
                onGestionar={handleGestionarCita}
                gestionando={gestionandoCitaId}
              />
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-slate-100 flex gap-3 sticky bottom-0 bg-white rounded-b-2xl">
            <button onClick={onClose} className="btn-secondary btn-sm flex-1">Cancelar</button>
            <div className="flex-1 relative group">
              <button
                onClick={() => esEdicion ? editarMutation.mutate() : crearMutation.mutate()}
                disabled={!puedeGuardar || isPending}
                className="btn-primary btn-sm w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending
                  ? 'Guardando...'
                  : esEdicion
                  ? 'Guardar cambios'
                  : 'Confirmar movimiento'}
              </button>
              {bloqueadoPorCitas && !isPending && (
                <span className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                  Gestiona las citas pendientes antes de confirmar
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
