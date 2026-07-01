import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, addDays, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { notificacionesApi, type NotificacionAdmin } from '../api/notificaciones';
import { sedesApi } from '../api';
import { cn } from '../utils/cn';

const MAX_CHARS = 500;

function badgeEstado(n: NotificacionAdmin) {
  if (n.estaActiva) return { label: 'Activa', cls: 'bg-emerald-100 text-emerald-700' };
  const now = new Date();
  if (parseISO(n.activaDesde) > now) return { label: 'Próxima', cls: 'bg-blue-100 text-blue-700' };
  return { label: 'Vencida', cls: 'bg-slate-100 text-slate-500' };
}

export function NotificacionesAdminPage() {
  const qc = useQueryClient();

  // Form state
  const [mensaje, setMensaje] = useState('');
  const [dias, setDias] = useState(7);
  const [todasLasSedes, setTodasLasSedes] = useState(true);
  const [sedeIds, setSedeIds] = useState<string[]>([]);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editTieneVistas, setEditTieneVistas] = useState(false);

  const { data: sedes } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });
  const { data: notificaciones } = useQuery({
    queryKey: ['notificaciones-admin'],
    queryFn: notificacionesApi.admin.listar,
  });

  const activaHastaDate = addDays(new Date(), dias);
  const activaHastaStr = format(activaHastaDate, 'yyyy-MM-dd');
  const activaHastaLabel = format(activaHastaDate, "EEE d MMM", { locale: es });

  const resetForm = () => {
    setMensaje('');
    setDias(7);
    setTodasLasSedes(true);
    setSedeIds([]);
    setEditandoId(null);
    setEditTieneVistas(false);
  };

  const cargarEditar = (n: NotificacionAdmin) => {
    setEditandoId(n.id);
    setMensaje(n.mensaje);
    const diasRestantes = Math.max(
      1,
      Math.ceil((parseISO(n.activaHasta).getTime() - Date.now()) / 86400000),
    );
    setDias(diasRestantes);
    setTodasLasSedes(n.todasLasSedes);
    setSedeIds(n.sedes.map(s => s.id));
    setEditTieneVistas(n.totalVistas > 0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const crearMutation = useMutation({
    mutationFn: () =>
      notificacionesApi.admin.crear({
        mensaje,
        activaHasta: activaHastaStr,
        todasLasSedes,
        sedeIds: todasLasSedes ? undefined : sedeIds,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notificaciones-admin'] });
      toast.success('Notificación publicada');
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editarMutation = useMutation({
    mutationFn: () =>
      notificacionesApi.admin.editar(editandoId!, {
        mensaje: editTieneVistas ? undefined : mensaje,
        activaHasta: activaHastaStr,
        todasLasSedes: editTieneVistas ? undefined : todasLasSedes,
        sedeIds: (editTieneVistas || todasLasSedes) ? undefined : sedeIds,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notificaciones-admin'] });
      toast.success('Notificación actualizada');
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const eliminarMutation = useMutation({
    mutationFn: (id: string) => notificacionesApi.admin.eliminar(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notificaciones-admin'] });
      toast.success('Notificación eliminada');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mensaje.trim()) return;
    if (!todasLasSedes && sedeIds.length === 0) {
      toast.error('Selecciona al menos una sede');
      return;
    }
    if (editandoId) editarMutation.mutate();
    else crearMutation.mutate();
  };

  const toggleSede = (id: string) =>
    setSedeIds(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);

  const isPending = crearMutation.isPending || editarMutation.isPending;

  return (
    <div className="flex-1 overflow-y-auto">
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-8">
      <div>
        <h1 className="text-xl font-bold text-slate-900">🔔 Notificaciones</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Los avisos activos aparecen al iniciar sesión las recepcionistas.
        </p>
      </div>

      {/* ── Formulario ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
          {editandoId ? (
            <>✏️ Editar notificación {editTieneVistas && <span className="text-xs font-normal text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">ya fue vista — solo puedes cambiar la fecha</span>}</>
          ) : (
            '➕ Nueva notificación'
          )}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Mensaje */}
          <div>
            <div className="relative">
              <textarea
                value={mensaje}
                onChange={e => setMensaje(e.target.value.slice(0, MAX_CHARS))}
                rows={4}
                placeholder="Escribe el mensaje aquí..."
                disabled={editTieneVistas}
                className={cn(
                  'w-full input resize-none pr-16',
                  editTieneVistas && 'bg-slate-50 text-slate-500 cursor-not-allowed',
                )}
              />
              <span className={cn(
                'absolute bottom-2.5 right-3 text-xs',
                mensaje.length > MAX_CHARS * 0.9 ? 'text-amber-500' : 'text-slate-400',
              )}>
                {mensaje.length}/{MAX_CHARS}
              </span>
            </div>
            {editTieneVistas && (
              <p className="text-xs text-amber-600 mt-1">
                Este mensaje ya fue visto por recepcionistas. Solo puedes modificar la fecha de vencimiento.
              </p>
            )}
          </div>

          {/* Días activa */}
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-sm font-medium text-slate-700 shrink-0">Activa durante:</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={90}
                value={dias}
                onChange={e => setDias(Math.max(1, Math.min(90, parseInt(e.target.value) || 1)))}
                className="input w-20 text-center"
              />
              <span className="text-sm text-slate-600">días</span>
            </div>
            <span className="text-sm text-slate-500">
              → se mostrará hasta el <span className="font-semibold text-slate-700">{activaHastaLabel}</span>
            </span>
          </div>

          {/* Destino — oculto en edición con vistas */}
          {!editTieneVistas && (
            <div className="space-y-2.5">
              <label className="text-sm font-medium text-slate-700">Destino:</label>
              <div className="space-y-2">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="radio"
                    checked={todasLasSedes}
                    onChange={() => { setTodasLasSedes(true); setSedeIds([]); }}
                    className="accent-limablue-600"
                  />
                  <span className="text-sm text-slate-700">Todas las sedes</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="radio"
                    checked={!todasLasSedes}
                    onChange={() => setTodasLasSedes(false)}
                    className="accent-limablue-600"
                  />
                  <span className="text-sm text-slate-700">Sedes específicas:</span>
                </label>
                {!todasLasSedes && (
                  <div className="ml-7 flex flex-wrap gap-2">
                    {sedes?.map(s => (
                      <label key={s.id} className="flex items-center gap-1.5 cursor-pointer text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={sedeIds.includes(s.id)}
                          onChange={() => toggleSede(s.id)}
                          className="accent-limablue-600"
                        />
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                        {s.nombre}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Acciones */}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={isPending || !mensaje.trim()}
              className="btn-primary btn-sm disabled:opacity-50"
            >
              {isPending
                ? 'Guardando...'
                : editandoId
                ? 'Guardar cambios'
                : 'Publicar notificación'}
            </button>
            {editandoId && (
              <button type="button" onClick={resetForm} className="btn-secondary btn-sm">
                Cancelar
              </button>
            )}
          </div>
        </form>
      </div>

      {/* ── Historial ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">Historial</h2>
          <p className="text-xs text-slate-500 mt-0.5">Últimas 50 notificaciones</p>
        </div>

        {!notificaciones || notificaciones.length === 0 ? (
          <div className="px-6 py-12 text-center text-slate-400 text-sm">
            Aún no hay notificaciones publicadas.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 bg-slate-50 border-b border-slate-100">
                  <th className="px-4 py-3 text-left font-semibold">Estado</th>
                  <th className="px-4 py-3 text-left font-semibold">Mensaje</th>
                  <th className="px-4 py-3 text-left font-semibold">Sedes</th>
                  <th className="px-4 py-3 text-left font-semibold">Vence</th>
                  <th className="px-4 py-3 text-left font-semibold">Vistas</th>
                  <th className="px-4 py-3 text-left font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {notificaciones.map(n => {
                  const badge = badgeEstado(n);
                  return (
                    <tr key={n.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', badge.cls)}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <p className="text-slate-700 truncate" title={n.mensaje}>
                          {n.mensaje.length > 80 ? n.mensaje.slice(0, 80) + '…' : n.mensaje}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">por {n.autor.nombre}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                        {n.todasLasSedes ? 'Todas' : n.sedes.map(s => s.nombre).join(', ') || '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600 text-xs">
                        {format(parseISO(n.activaHasta), 'd MMM yyyy', { locale: es })}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={cn(
                          'text-xs font-medium',
                          n.totalVistas > 0 ? 'text-slate-700' : 'text-slate-400',
                        )}>
                          {n.totalVistas} {n.totalVistas === 1 ? 'vista' : 'vistas'}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => cargarEditar(n)}
                            title="Editar"
                            className="text-slate-400 hover:text-limablue-600 transition-colors"
                          >
                            ✏️
                          </button>
                          <div className="relative group">
                            <button
                              onClick={() => {
                                if (n.totalVistas > 0) return;
                                if (confirm('¿Eliminar esta notificación?')) {
                                  eliminarMutation.mutate(n.id);
                                }
                              }}
                              disabled={n.totalVistas > 0}
                              className={cn(
                                'transition-colors',
                                n.totalVistas > 0
                                  ? 'opacity-30 cursor-not-allowed'
                                  : 'text-slate-400 hover:text-red-500',
                              )}
                              title={n.totalVistas > 0 ? `No se puede eliminar — ya fue visto` : 'Eliminar'}
                            >
                              🗑️
                            </button>
                            {n.totalVistas > 0 && (
                              <span className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                                No se puede eliminar — ya fue visto
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
