import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useAuthStore } from '../../../stores/authStore';
import { agentesApi, type AgenteKpis } from '../../../api/analyticsAgentes';
import { StatCard, CardSkeleton, CardVacio, CardError, exportToExcel, fmtInt } from '../ui';
import { useAgentesFiltros } from './filtros';
import { AgentesFilterBar } from './AgentesFilterBar';
import { AgenteAvatar, AreaBadge, fmtTasa, EstadoVacio } from './ui';
import { AREA_COLOR } from '../../../api/analyticsAgentes';
import { cn } from '../../../utils/cn';

const TooltipStyle = { fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' } as const;

type ColKey = 'nombre' | 'score' | 'agendamientos' | 'showRate' | 'reprogramaciones' | 'cancelaciones' | 'recitacion';

const valorCol = (a: AgenteKpis, col: ColKey): number | string | null => {
  switch (col) {
    case 'nombre': return a.nombre;
    case 'score': return a.score;
    case 'agendamientos': return a.volumen.agendamientos;
    case 'showRate': return a.calidad.showRate;
    case 'reprogramaciones': return a.gestion.reprogramaciones;
    case 'cancelaciones': return a.gestion.cancelacionesEjecutadas;
    case 'recitacion': return a.conversion.tasaRecitacion;
  }
};

export function AgentesResumenPage() {
  const tiene = useAuthStore(s => s.tiene);
  const navigate = useNavigate();
  const ctx = useAgentesFiltros();
  const { params, search, area } = ctx;
  const [orden, setOrden] = useState<{ col: ColKey; desc: boolean }>({ col: 'score', desc: true });

  const q = useQuery({
    queryKey: ['agentes-resumen', params],
    queryFn: () => agentesApi.resumen(params),
    staleTime: 60_000,
    enabled: tiene('analytics.agentes'),
  });

  const agentesOrdenados = useMemo(() => {
    const lista = [...(q.data?.agentes ?? [])];
    lista.sort((a, b) => {
      const va = valorCol(a, orden.col);
      const vb = valorCol(b, orden.col);
      if (typeof va === 'string' || typeof vb === 'string') {
        return (orden.desc ? -1 : 1) * String(va).localeCompare(String(vb));
      }
      // null ("sin datos") SIEMPRE al final, sea asc o desc.
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return orden.desc ? vb - va : va - vb;
    });
    return lista;
  }, [q.data, orden]);

  if (!tiene('analytics.agentes')) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <p className="text-slate-600 font-semibold">Acceso restringido</p>
          <p className="text-slate-400 text-sm mt-1">Requiere el permiso "Ver desempeño de agentes".</p>
        </div>
      </div>
    );
  }

  const t = q.data?.totales;
  const v = q.data?.variaciones;
  const mostrarRecitacion = area !== 'CONTACT_CENTER';

  function exportar() {
    if (!q.data) return;
    exportToExcel(`desempeno_agentes_${params.desde}_${params.hasta}.xlsx`, [{
      name: 'Agentes',
      data: agentesOrdenados.map(a => ({
        Agente: a.nombre, 'Área': a.area, Sede: a.sede?.nombre ?? '—',
        Score: a.score ?? '—', Agendamientos: a.volumen.agendamientos, 'Citas individuales': a.volumen.citasIndividuales,
        'Show rate %': a.calidad.showRate ?? '—', 'No-show %': a.calidad.noShowRate ?? '—',
        Reprogramaciones: a.gestion.reprogramaciones, Reacomodos: a.gestion.reacomodos,
        Cancelaciones: a.gestion.cancelacionesEjecutadas, Confirmaciones: a.gestion.confirmacionesGestionadas,
        'Recitación %': a.conversion.tasaRecitacion ?? '—', 'Bloques combinados %': a.conversion.tasaBloquesCombinados ?? '—',
        'Lead time (días)': a.calidad.leadTimeDias ?? '—',
      })),
    }]);
  }

  const encabezado = (col: ColKey, label: string, alignRight = true) => (
    <th
      className={cn('px-3 py-2.5 font-semibold text-slate-500 cursor-pointer select-none whitespace-nowrap hover:text-limablue-600', alignRight ? 'text-right' : 'text-left')}
      onClick={() => setOrden(o => ({ col, desc: o.col === col ? !o.desc : true }))}
    >
      {label}{orden.col === col && <span className="ml-0.5 text-limablue-500">{orden.desc ? '↓' : '↑'}</span>}
    </th>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3 flex-shrink-0">
        <button onClick={() => navigate({ pathname: '/analytics', search: search ? `?${search}` : '' })} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-all" title="Volver al tablero">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div>
          <h1 className="text-lg font-black text-slate-800">Desempeño de Agentes</h1>
          <p className="text-xs text-slate-400">Contact Center y Recepción · solo citas con autor registrado</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => navigate({ pathname: '/analytics/agentes/comparativa', search: search ? `?${search}` : '' })}
            className="px-4 py-2 bg-limablue-600 text-white text-sm font-semibold rounded-xl hover:bg-limablue-700 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V9m4 8V5m4 12v-4" /></svg>
            Comparar agentes
          </button>
          <button onClick={exportar} className="px-3 py-2 text-xs font-semibold text-slate-500 border border-slate-200 rounded-xl hover:bg-slate-50">Excel</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <AgentesFilterBar ctx={ctx} />

        <div className="p-6 space-y-6">
          {/* Stat cards del área */}
          <div className={cn('grid gap-4', mostrarRecitacion ? 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6' : 'grid-cols-2 md:grid-cols-5')}>
            <StatCard label="Agendamientos" value={t ? fmtInt(t.agendamientos) : '—'} delta={v?.agendamientos} loading={q.isLoading} accent />
            <StatCard label="Show rate" value={t ? fmtTasa(t.showRate) : '—'} delta={v?.showRate} loading={q.isLoading} />
            <StatCard label="Reprogramaciones" value={t ? fmtInt(t.reprogramaciones) : '—'} suffix="cambio de día" delta={v?.reprogramaciones} deltaInvertido loading={q.isLoading} />
            <StatCard label="Reacomodos" value={t ? fmtInt(t.reacomodos) : '—'} suffix="mismo día" loading={q.isLoading} />
            <StatCard label="Cancelaciones" value={t ? fmtInt(t.cancelaciones) : '—'} delta={v?.cancelaciones} deltaInvertido loading={q.isLoading} />
            {mostrarRecitacion && (
              <StatCard label="Recitación" value={t ? fmtTasa(t.tasaRecitacion) : '—'} delta={v?.tasaRecitacion} loading={q.isLoading} />
            )}
          </div>

          {/* Tendencia semanal */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h2 className="text-sm font-bold text-slate-700 mb-3">Tendencia semanal — agendamientos y show rate</h2>
            {q.isLoading ? <CardSkeleton height={200} /> : q.isError ? <CardError /> : (q.data?.tendenciaSemanal.length ?? 0) === 0 ? <CardVacio /> : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={q.data!.tendenciaSemanal} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="semana" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={s => `sem ${String(s).slice(5)}`} />
                  <YAxis yAxisId="izq" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis yAxisId="der" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <Tooltip contentStyle={TooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line yAxisId="izq" type="monotone" dataKey="agendamientos" name="Agendamientos" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  <Line yAxisId="der" type="monotone" dataKey="showRate" name="Show rate %" stroke="#10b981" strokeWidth={2} dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Tabla de agentes */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-5 pt-4 pb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-700">Agentes</h2>
              <p className="text-[11px] text-slate-400">clic en una columna para ordenar · clic en una fila para el detalle</p>
            </div>
            {q.isLoading ? <div className="p-5"><CardSkeleton height={240} /></div> : q.isError ? <div className="p-5"><CardError /></div> : agentesOrdenados.length === 0 ? (
              <EstadoVacio titulo="Sin agentes clasificados" mensaje="Ningún usuario tiene área asignada (Contact Center / Recepción) con los filtros actuales." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-y border-slate-100">
                    <tr>
                      {encabezado('nombre', 'Agente', false)}
                      {encabezado('score', 'Score')}
                      {encabezado('agendamientos', 'Agendamientos')}
                      {encabezado('showRate', 'Show rate')}
                      {encabezado('reprogramaciones', 'Reprogr.')}
                      {encabezado('cancelaciones', 'Cancel.')}
                      {mostrarRecitacion ? encabezado('recitacion', 'Recitación') : null}
                    </tr>
                  </thead>
                  <tbody>
                    {agentesOrdenados.map(a => (
                      <tr
                        key={a.agenteId}
                        className="border-b border-slate-50 hover:bg-limablue-50/40 cursor-pointer transition-colors"
                        onClick={() => navigate({ pathname: `/analytics/agentes/${a.agenteId}`, search: search ? `?${search}` : '' })}
                      >
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <AgenteAvatar nombre={a.nombre} color={AREA_COLOR[a.area]} size="sm" />
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-700 truncate">{a.nombre}</p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <AreaBadge area={a.area} compact />
                                {a.sede && <span className="text-[10px] text-slate-400 truncate">{a.sede.nombre}</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {a.score === null ? <span className="text-slate-300">—</span> : (
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${a.score}%`, backgroundColor: a.score >= 70 ? '#10b981' : a.score >= 45 ? '#f59e0b' : '#ef4444' }} />
                              </div>
                              <span className="font-black tabular-nums w-7">{a.score}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold tabular-nums">{a.sinDatos ? <span className="text-slate-300">—</span> : fmtInt(a.volumen.agendamientos)}</td>
                        <td className={cn('px-3 py-2.5 text-right font-bold tabular-nums', a.calidad.showRate === null ? 'text-slate-300' : '')}>{fmtTasa(a.calidad.showRate)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{a.sinDatos ? <span className="text-slate-300">—</span> : a.gestion.reprogramaciones}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{a.sinDatos ? <span className="text-slate-300">—</span> : a.gestion.cancelacionesEjecutadas}</td>
                        {mostrarRecitacion ? (
                          <td className={cn('px-3 py-2.5 text-right font-semibold tabular-nums', a.conversion.tasaRecitacion === null ? 'text-slate-300' : '')}>
                            {a.area === 'RECEPCION' ? fmtTasa(a.conversion.tasaRecitacion) : <span className="text-slate-300">n/a</span>}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
