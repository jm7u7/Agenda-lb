import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { combinacionesApi } from '../../api/combinaciones';
import { serviciosApi } from '../../api';
import { useAuthStore } from '../../stores/authStore';

export function CombinacionesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const esAdmin = useAuthStore(s => s.isAdmin());
  const [nuevoExtra, setNuevoExtra] = useState('');

  const { data: combinaciones = [], isLoading } = useQuery({
    queryKey: ['combinaciones-admin'],
    queryFn: combinacionesApi.listarAdmin,
    enabled: esAdmin,
  });
  const { data: config } = useQuery({
    queryKey: ['combinaciones-config'],
    queryFn: combinacionesApi.config,
    enabled: esAdmin,
  });
  const { data: servicios = [] } = useQuery({
    queryKey: ['servicios-todos'],
    queryFn: () => serviciosApi.listar({ activo: true }),
    enabled: esAdmin,
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['combinaciones-admin'] });
    qc.invalidateQueries({ queryKey: ['combinaciones-config'] });
  };

  const anclaMut = useMutation({
    mutationFn: (servicioAnclaId: string | null) => combinacionesApi.setAncla(servicioAnclaId),
    onSuccess: () => { invalidar(); toast.success('Servicio ancla actualizado'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const agregarMut = useMutation({
    mutationFn: (servicioExtraId: string) => combinacionesApi.agregar(servicioExtraId),
    onSuccess: () => { invalidar(); setNuevoExtra(''); toast.success('Servicio combinable agregado'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggleMut = useMutation({
    mutationFn: ({ id, activo }: { id: string; activo: boolean }) => combinacionesApi.setActivo(id, activo),
    onSuccess: () => invalidar(),
    onError: (e: Error) => toast.error(e.message),
  });
  const quitarMut = useMutation({
    mutationFn: (id: string) => combinacionesApi.quitar(id),
    onSuccess: () => { invalidar(); toast.success('Servicio quitado de la lista'); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!esAdmin) {
    return <div className="flex-1 flex items-center justify-center bg-slate-50 text-slate-400 text-sm">Solo el administrador puede configurar las combinaciones.</div>;
  }

  const anclaId = config?.servicioAnclaId ?? '';
  const yaCombinables = new Set(combinaciones.map(c => c.servicioExtraId));
  // Servicios elegibles para agregar: activos, no son el ancla, no están ya en la lista.
  const candidatos = servicios.filter(s => s.id !== anclaId && !yaCombinables.has(s.id));

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/herramientas')} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-all" title="Volver a Herramientas">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="w-9 h-9 rounded-xl bg-violet-500 flex items-center justify-center shrink-0"><span className="text-white text-lg">🔗</span></div>
        <div>
          <h1 className="text-base font-bold text-slate-900">Bloques combinados</h1>
          <p className="text-xs text-slate-500">Servicio ancla (profilaxis) + servicios que pueden combinarse en el mismo turno.</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {/* Servicio ancla */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-1">Servicio ancla para combinaciones</h2>
          <p className="text-xs text-slate-500 mb-3">Es el servicio principal (profilaxis). El toggle “Combinar” solo aparece al agendar este servicio.</p>
          <select
            className="input text-sm"
            value={anclaId}
            onChange={e => anclaMut.mutate(e.target.value || null)}
            disabled={anclaMut.isPending}
          >
            <option value="">— Sin ancla (combinaciones desactivadas) —</option>
            {servicios.map(s => (
              <option key={s.id} value={s.id}>{s.nombre} ({s.duracionMinutos} min)</option>
            ))}
          </select>
        </div>

        {/* Servicios combinables */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-1">Servicios combinables con la profilaxis</h2>
          <p className="text-xs text-slate-500 mb-3">Estos aparecen como “servicio extra” al combinar. Desactiva para ocultarlos sin perderlos.</p>

          {/* Agregar */}
          <div className="flex gap-2 mb-4">
            <select className="input text-sm flex-1" value={nuevoExtra} onChange={e => setNuevoExtra(e.target.value)}>
              <option value="">-- Agregar servicio combinable --</option>
              {candidatos.map(s => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
            <button
              className="btn-primary text-sm px-4 disabled:opacity-50"
              disabled={!nuevoExtra || agregarMut.isPending}
              onClick={() => agregarMut.mutate(nuevoExtra)}
            >
              Agregar
            </button>
          </div>

          {/* Lista */}
          {isLoading ? (
            <p className="text-xs text-slate-400">Cargando…</p>
          ) : combinaciones.length === 0 ? (
            <p className="text-xs text-slate-400">Aún no hay servicios combinables. Agrega uno arriba.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {combinaciones.map(c => (
                <li key={c.id} className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.servicio.color }} />
                    <span className={`text-sm truncate ${c.activo ? 'text-slate-800' : 'text-slate-400 line-through'}`}>
                      {c.servicio.nombre}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      className={`text-xs font-semibold px-2 py-1 rounded-md ${c.activo ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                      onClick={() => toggleMut.mutate({ id: c.id, activo: !c.activo })}
                      disabled={toggleMut.isPending}
                    >
                      {c.activo ? 'Activo' : 'Inactivo'}
                    </button>
                    <button
                      className="text-xs text-red-500 hover:text-red-700 px-2 py-1"
                      onClick={() => quitarMut.mutate(c.id)}
                      disabled={quitarMut.isPending}
                      title="Quitar de la lista"
                    >
                      Quitar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
