import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { canalesApi, type Canal } from '../../api/canales';
import { useAuthStore } from '../../stores/authStore';

export function CanalesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const puedeGestionar = useAuthStore(s => s.isCoordinadora()); // admin + coordinadora_sedes
  const [nuevo, setNuevo] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');

  const { data: canales = [], isLoading } = useQuery({
    queryKey: ['canales-todos'],
    queryFn: canalesApi.todos,
    enabled: puedeGestionar,
  });

  const invalidar = () => { qc.invalidateQueries({ queryKey: ['canales-todos'] }); qc.invalidateQueries({ queryKey: ['canales-activos'] }); };

  const crearMut = useMutation({
    mutationFn: () => canalesApi.crear(nuevo.trim()),
    onSuccess: () => { invalidar(); setNuevo(''); toast.success('Canal agregado'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const actualizarMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<{ etiqueta: string; activo: boolean }> }) => canalesApi.actualizar(id, data),
    onSuccess: () => { invalidar(); setEditId(null); },
    onError: (e: Error) => toast.error(e.message),
  });
  const eliminarMut = useMutation({
    mutationFn: (id: string) => canalesApi.eliminar(id),
    onSuccess: (r) => { invalidar(); toast.success(r.desactivado ? `Canal desactivado (tiene ${r.enUso} citas, se conserva el historial)` : 'Canal eliminado'); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!puedeGestionar) {
    return <div className="flex-1 flex items-center justify-center bg-slate-50 text-slate-400 text-sm">Solo la Coordinadora de Sedes (y el admin) pueden gestionar canales.</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/herramientas')} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-all" title="Volver a Herramientas">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center shrink-0"><span className="text-white text-lg">📣</span></div>
        <div>
          <h1 className="text-base font-bold text-slate-900">Canales de Reserva</h1>
          <p className="text-xs text-slate-500">De dónde viene el cliente — agrega o quita canales. Alimenta el KPI de Analytics.</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Nuevo canal */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Agregar canal</p>
          <div className="flex gap-2">
            <input
              className="input text-sm flex-1"
              placeholder="Ej: TikTok Ads, EXPO 2027, Volante…"
              value={nuevo}
              maxLength={60}
              onChange={e => setNuevo(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && nuevo.trim().length >= 2) crearMut.mutate(); }}
            />
            <button
              onClick={() => crearMut.mutate()}
              disabled={nuevo.trim().length < 2 || crearMut.isPending}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-40 transition-colors shrink-0"
            >+ Agregar</button>
          </div>
        </div>

        {/* Lista */}
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest px-1">Canales</p>
          {isLoading ? (
            <div className="flex justify-center py-8"><div className="w-7 h-7 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" /></div>
          ) : canales.map((c: Canal) => (
            <div key={c.id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                {editId === c.id ? (
                  <div className="flex gap-2">
                    <input className="input text-sm flex-1" value={editVal} onChange={e => setEditVal(e.target.value)} autoFocus
                      onKeyDown={e => { if (e.key === 'Enter') actualizarMut.mutate({ id: c.id, data: { etiqueta: editVal.trim() } }); }} />
                    <button onClick={() => actualizarMut.mutate({ id: c.id, data: { etiqueta: editVal.trim() } })} className="text-xs font-semibold text-amber-700 px-2">Guardar</button>
                    <button onClick={() => setEditId(null)} className="text-xs text-slate-400 px-1">Cancelar</button>
                  </div>
                ) : (
                  <p className={'text-sm font-semibold ' + (c.activo ? 'text-slate-900' : 'text-slate-400 line-through')}>
                    {c.etiqueta}
                    {!c.activo && <span className="ml-2 text-xxs font-normal text-slate-400">(inactivo)</span>}
                    {(c.enUso ?? 0) > 0 && <span className="ml-2 text-xxs font-normal text-slate-400">· {c.enUso} citas</span>}
                  </p>
                )}
              </div>
              {editId !== c.id && (
                <div className="flex items-center gap-1 shrink-0">
                  {/* Activar / desactivar */}
                  <button
                    onClick={() => actualizarMut.mutate({ id: c.id, data: { activo: !c.activo } })}
                    className={'text-xxs font-semibold px-2 py-1 rounded-lg ' + (c.activo ? 'text-slate-500 hover:bg-slate-100' : 'text-emerald-600 hover:bg-emerald-50')}
                    title={c.activo ? 'Desactivar (deja de aparecer al reservar)' : 'Activar'}
                  >{c.activo ? 'Desactivar' : 'Activar'}</button>
                  <button onClick={() => { setEditId(c.id); setEditVal(c.etiqueta); }} className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all" title="Renombrar">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                  </button>
                  <button onClick={() => eliminarMut.mutate(c.id)} disabled={eliminarMut.isPending} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all disabled:opacity-50" title="Quitar">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              )}
            </div>
          ))}
          <p className="text-xxs text-slate-400 px-1 pt-1">Si quitas un canal que ya tiene citas, se <b>desactiva</b> (no se borra) para conservar el historial y el KPI. Si no tiene citas, se elimina.</p>
        </div>
      </div>
    </div>
  );
}
