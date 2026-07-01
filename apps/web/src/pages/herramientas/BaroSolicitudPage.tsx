import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { baroSolicitudApi, type ProfBaro } from '../../api/baroSolicitud';
import { useAuthStore } from '../../stores/authStore';

const TIPO_LABEL: Record<string, string> = { medico: 'Médico', podologa: 'Podóloga', fisioterapeuta: 'Fisioterapeuta' };

export function BaroSolicitudPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const puedeGestionar = useAuthStore(s => s.isCoordinadora()); // admin + coordinadora_sedes
  const [aAgregar, setAAgregar] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['baro-solicitud'],
    queryFn: baroSolicitudApi.obtener,
    enabled: puedeGestionar,
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['baro-solicitud'] });
    // Afecta la disponibilidad/columnas de la agenda y los seleccionables al reservar.
    qc.invalidateQueries({ queryKey: ['profesionales-sede'] });
    qc.invalidateQueries({ queryKey: ['seleccionables'] });
  };

  const agregarMut = useMutation({
    mutationFn: (id: string) => baroSolicitudApi.agregar(id),
    onSuccess: () => { invalidar(); setAAgregar(''); toast.success('Médico agregado a la lista por solicitud'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const quitarMut = useMutation({
    mutationFn: (id: string) => baroSolicitudApi.quitar(id),
    onSuccess: () => { invalidar(); toast.success('Quitado de la lista por solicitud'); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!puedeGestionar) {
    return <div className="flex-1 flex items-center justify-center bg-slate-50 text-slate-400 text-sm">Solo la Coordinadora de Sedes (y el admin) pueden gestionar esta lista.</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/herramientas')} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-all" title="Volver a Herramientas">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="w-9 h-9 rounded-xl bg-rose-500 flex items-center justify-center shrink-0"><span className="text-white text-lg">🦶</span></div>
        <div>
          <h1 className="text-base font-bold text-slate-900">Baropodometría — Atención por solicitud</h1>
          <p className="text-xs text-slate-500">Médicos (y Daniel) que atienden baropodometría solo cuando el paciente los pide.</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Explicación */}
        <div className="bg-rose-50 border border-rose-100 rounded-xl p-4 text-xs text-rose-900 leading-relaxed">
          La baropodometría se asigna <b>automáticamente</b> por defecto. Quienes estén en esta lista <b>no</b> se auto-asignan ni ocupan columna fija:
          aparecen como opción al reservar y como columna solo el día que tienen cita. Atienden en cualquier sede.
        </div>

        {/* Agregar */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Agregar a la lista</p>
          <div className="flex gap-2">
            <select className="input text-sm flex-1" value={aAgregar} onChange={e => setAAgregar(e.target.value)}>
              <option value="">Selecciona un profesional…</option>
              {(data?.disponibles ?? []).map((p: ProfBaro) => (
                <option key={p.id} value={p.id}>{p.nombre} · {TIPO_LABEL[p.tipo] ?? p.tipo}</option>
              ))}
            </select>
            <button
              onClick={() => aAgregar && agregarMut.mutate(aAgregar)}
              disabled={!aAgregar || agregarMut.isPending}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-40 transition-colors shrink-0"
            >+ Agregar</button>
          </div>
        </div>

        {/* Lista actual */}
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest px-1">
            En la lista por solicitud {data && <span className="text-slate-400">· {data.porSolicitud.length}</span>}
          </p>
          {isLoading ? (
            <div className="flex justify-center py-8"><div className="w-7 h-7 border-2 border-rose-400 border-t-transparent rounded-full animate-spin" /></div>
          ) : (data?.porSolicitud.length ?? 0) === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-slate-400 text-sm">Nadie está marcado como "por solicitud" todavía.</div>
          ) : (
            data!.porSolicitud.map((p) => (
              <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center text-xs font-bold shrink-0">
                  {p.nombre.split(' ').map(w => w[0]).slice(0, 2).join('')}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">
                    {p.nombre}
                    {p.activo === false && <span className="ml-2 text-xxs font-normal text-slate-400">(inactivo)</span>}
                  </p>
                  <p className="text-xxs text-slate-400">{TIPO_LABEL[p.tipo] ?? p.tipo} · cubre {p.servicios ?? 0} de {data!.servicios.length} servicios</p>
                </div>
                <button
                  onClick={() => quitarMut.mutate(p.id)}
                  disabled={quitarMut.isPending}
                  className="text-xs font-semibold text-slate-500 hover:text-red-500 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors shrink-0 disabled:opacity-50"
                  title="Quitar de la lista por solicitud"
                >Quitar</button>
              </div>
            ))
          )}
          <p className="text-xxs text-slate-400 px-1 pt-1">Al quitar a alguien, se desactiva su atención de baropodometría por solicitud (no se borra el historial de citas pasadas).</p>
        </div>
      </div>
    </div>
  );
}
