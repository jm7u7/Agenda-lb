import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useAuthStore } from '../../../stores/authStore';
import { agentesApi, AREA_COLOR } from '../../../api/analyticsAgentes';
import { StatCard, CardSkeleton, CardError, CardVacio, fmtInt } from '../ui';
import { useAgentesFiltros } from './filtros';
import { AgentesFilterBar } from './AgentesFilterBar';
import { AgenteAvatar, AreaBadge, ScoreRing, fmtTasa } from './ui';
import { cn } from '../../../utils/cn';

const TooltipStyle = { fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' } as const;

const ESTADO_COLOR: Record<string, string> = {
  completada: 'bg-emerald-50 text-emerald-600',
  no_show: 'bg-red-50 text-red-500',
  cancelada: 'bg-slate-100 text-slate-500',
  agendada: 'bg-blue-50 text-blue-600',
  confirmada: 'bg-indigo-50 text-indigo-600',
  llego: 'bg-amber-50 text-amber-600',
  en_atencion: 'bg-violet-50 text-violet-600',
  reprogramada: 'bg-slate-100 text-slate-400',
};

function BarraDesglose({ items }: { items: { nombre: string; color: string; citas: number }[] }) {
  const max = Math.max(...items.map(i => i.citas), 1);
  return (
    <div className="space-y-2">
      {items.map(i => (
        <div key={i.nombre} className="flex items-center gap-2">
          <span className="text-xs text-slate-600 truncate flex-1 min-w-0">{i.nombre}</span>
          <div className="w-24 bg-slate-100 rounded-full h-1.5 overflow-hidden shrink-0">
            <div className="h-full rounded-full" style={{ width: `${(i.citas / max) * 100}%`, backgroundColor: i.color }} />
          </div>
          <span className="text-xs font-bold text-slate-700 tabular-nums w-8 text-right shrink-0">{fmtInt(i.citas)}</span>
        </div>
      ))}
    </div>
  );
}

export function AgenteDetallePage() {
  const tiene = useAuthStore(s => s.tiene);
  const navigate = useNavigate();
  const { agenteId } = useParams<{ agenteId: string }>();
  const ctx = useAgentesFiltros();
  const { params, search } = ctx;
  const [pagina, setPagina] = useState(1);
  const [verTimeline, setVerTimeline] = useState(false);
  const [paginaTl, setPaginaTl] = useState(1);

  const habilitado = tiene('analytics.agentes') && !!agenteId;
  const q = useQuery({ queryKey: ['agente-detalle', agenteId, params], queryFn: () => agentesApi.agente(agenteId!, params), staleTime: 60_000, enabled: habilitado });
  const qCitas = useQuery({ queryKey: ['agente-citas', agenteId, params, pagina], queryFn: () => agentesApi.agenteCitas(agenteId!, params, pagina), staleTime: 60_000, enabled: habilitado });
  const qTl = useQuery({ queryKey: ['agente-timeline', agenteId, paginaTl], queryFn: () => agentesApi.timeline(agenteId!, paginaTl), staleTime: 60_000, enabled: habilitado && verTimeline });

  if (!tiene('analytics.agentes')) {
    return <div className="flex-1 flex items-center justify-center"><div className="text-center"><p className="text-4xl mb-3">🔒</p><p className="text-slate-600 font-semibold">Acceso restringido</p></div></div>;
  }

  const a = q.data?.agente;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3 flex-shrink-0">
        <button onClick={() => navigate({ pathname: '/analytics/agentes', search: search ? `?${search}` : '' })} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-all" title="Volver al resumen">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        {a ? (
          <>
            <AgenteAvatar nombre={a.nombre} color={AREA_COLOR[a.area]} size="lg" />
            <div className="min-w-0">
              <h1 className="text-lg font-black text-slate-800 truncate">{a.nombre}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <AreaBadge area={a.area} />
                {a.sede && <span className="text-xs text-slate-400">{a.sede.nombre}</span>}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Score compuesto</p>
                <p className="text-[10px] text-slate-400">percentil volumen: {a.percentiles.volumen ?? '—'}</p>
              </div>
              <ScoreRing score={a.score} size={56} />
            </div>
          </>
        ) : (
          <div><h1 className="text-lg font-black text-slate-800">Detalle de agente</h1></div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <AgentesFilterBar ctx={ctx} />

        <div className="p-6 space-y-6">
          {q.isLoading ? <CardSkeleton height={110} /> : q.isError ? <CardError /> : a && (
            <>
              {/* KPIs principales */}
              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
                <StatCard label="Agendamientos" value={a.sinDatos ? '—' : fmtInt(a.volumen.agendamientos)} suffix={a.sinDatos ? undefined : `${a.volumen.citasIndividuales} citas`} accent />
                <StatCard label="Show rate" value={fmtTasa(a.calidad.showRate)} suffix={a.calidad.showRate !== null ? `${a.calidad.completadas}/${a.calidad.vencidas}` : undefined} />
                <StatCard label="Reprogramaciones" value={a.sinDatos ? '—' : a.gestion.reprogramaciones} suffix={a.sinDatos ? undefined : `+${a.gestion.reacomodos} reacomodos`} />
                <StatCard label="Cancelaciones" value={a.sinDatos ? '—' : a.gestion.cancelacionesEjecutadas} />
                <StatCard label={a.area === 'RECEPCION' ? 'Recitación' : 'Bloques combinados'} value={a.area === 'RECEPCION' ? fmtTasa(a.conversion.tasaRecitacion) : fmtTasa(a.conversion.tasaBloquesCombinados)} />
                <StatCard label="Lead time" value={a.calidad.leadTimeDias === null ? '—' : a.calidad.leadTimeDias} suffix="días" />
              </div>

              {/* Métricas secundarias */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-x-6 gap-y-3 text-xs">
                {[
                  ['No-show rate', fmtTasa(a.calidad.noShowRate)],
                  ['Cancelación posterior', fmtTasa(a.calidad.cancelacionPosteriorRate)],
                  ['Retrabajo', fmtTasa(a.calidad.retrabajoRate)],
                  ['Calidad de datos', fmtTasa(a.calidad.calidadDatos)],
                  ['Pacientes nuevos', fmtTasa(a.conversion.mixPacientesNuevos)],
                  ['Uso de promociones', fmtTasa(a.conversion.tasaUsoPromociones)],
                  ['Confirmaciones', a.sinDatos ? '—' : String(a.gestion.confirmacionesGestionadas)],
                ].map(([lbl, val]) => (
                  <div key={lbl}>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{lbl}</p>
                    <p className={cn('font-black text-base tabular-nums mt-0.5', val === '—' ? 'text-slate-300' : 'text-slate-700')}>{val}</p>
                  </div>
                ))}
              </div>

              {/* Serie semanal */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <h2 className="text-sm font-bold text-slate-700 mb-3">Actividad semanal</h2>
                {a.semanas.length === 0 ? <CardVacio /> : (
                  <ResponsiveContainer width="100%" height={190}>
                    <LineChart data={a.semanas.map(s => ({ ...s, showRate: s.vencidas > 0 ? Math.round((s.completadas / s.vencidas) * 100) : null }))} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="semana" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={s => `sem ${String(s).slice(5)}`} />
                      <YAxis yAxisId="izq" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                      <YAxis yAxisId="der" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                      <Tooltip contentStyle={TooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line yAxisId="izq" type="monotone" dataKey="agendamientos" name="Agendamientos" stroke={AREA_COLOR[a.area]} strokeWidth={2} dot={false} />
                      <Line yAxisId="der" type="monotone" dataKey="showRate" name="Show rate %" stroke="#10b981" strokeWidth={2} dot={false} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Desgloses */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                  <h2 className="text-sm font-bold text-slate-700 mb-3">Citas por sede</h2>
                  {(q.data?.porSede.length ?? 0) === 0 ? <CardVacio /> : (
                    <BarraDesglose items={q.data!.porSede.map(r => ({ nombre: r.sede.nombre, color: r.sede.color, citas: r.citas }))} />
                  )}
                </div>
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                  <h2 className="text-sm font-bold text-slate-700 mb-3">Citas por servicio</h2>
                  {(q.data?.porServicio.length ?? 0) === 0 ? <CardVacio /> : (
                    <BarraDesglose items={q.data!.porServicio.slice(0, 8).map(r => ({ nombre: r.servicio.nombre, color: r.servicio.color, citas: r.citas }))} />
                  )}
                </div>
              </div>
            </>
          )}

          {/* Citas del agente (paginadas) */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-5 pt-4 pb-2 flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-sm font-bold text-slate-700">Citas creadas en el período</h2>
              <button onClick={() => setVerTimeline(t => !t)} className="text-[11px] font-semibold text-limablue-600 hover:text-limablue-700">
                {verTimeline ? 'Ocultar historial de eventos' : 'Ver historial de eventos (AuditLog) →'}
              </button>
            </div>
            {qCitas.isLoading ? <div className="p-5"><CardSkeleton height={160} /></div> : qCitas.isError ? <div className="p-5"><CardError /></div> : (qCitas.data?.citas.length ?? 0) === 0 ? (
              <div className="p-5"><CardVacio mensaje="Sin citas creadas por este agente en el período" /></div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-y border-slate-100">
                      <tr>
                        {['Creada', 'Cita para', 'Paciente', 'Servicio', 'Sede', 'Estado', 'Extras'].map(h => (
                          <th key={h} className="px-3 py-2.5 text-left font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {qCitas.data!.citas.map(c => (
                        <tr key={c.id} className="border-b border-slate-50">
                          <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{c.creadoDia}</td>
                          <td className="px-3 py-2 font-mono text-[11px] text-slate-700">{String(c.fecha).slice(0, 10)} {c.horaInicio}</td>
                          <td className="px-3 py-2 text-slate-700 font-medium">{c.paciente.nombres} {c.paciente.apellidoPaterno}</td>
                          <td className="px-3 py-2 text-slate-600">{c.servicio.nombre}</td>
                          <td className="px-3 py-2"><span className="inline-flex items-center gap-1 text-slate-600"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.sede.color }} />{c.sede.nombre}</span></td>
                          <td className="px-3 py-2"><span className={cn('px-2 py-0.5 rounded-full font-semibold', ESTADO_COLOR[c.estado] ?? 'bg-slate-100 text-slate-500')}>{c.estado.replace('_', ' ')}</span></td>
                          <td className="px-3 py-2 text-[10px] text-slate-400 space-x-1">
                            {c.slotGrupoId && <span className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-500 font-semibold">bloque</span>}
                            {c.promocion && <span className="px-1.5 py-0.5 rounded bg-pink-50 text-pink-500 font-semibold">{c.promocion.nombre}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-5 py-3 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-50">
                  <span>{qCitas.data!.total} citas · página {qCitas.data!.page} de {qCitas.data!.totalPages}</span>
                  <div className="flex gap-1.5">
                    <button disabled={pagina <= 1} onClick={() => setPagina(p => p - 1)} className="px-2.5 py-1 rounded-lg border border-slate-200 font-semibold disabled:opacity-40 hover:bg-slate-50">←</button>
                    <button disabled={pagina >= (qCitas.data!.totalPages || 1)} onClick={() => setPagina(p => p + 1)} className="px-2.5 py-1 rounded-lg border border-slate-200 font-semibold disabled:opacity-40 hover:bg-slate-50">→</button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Timeline del AuditLog (para resolver disputas) */}
          {verTimeline && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-5 pt-4 pb-2">
                <h2 className="text-sm font-bold text-slate-700">Historial de eventos (AuditLog · solo lectura)</h2>
                <p className="text-[11px] text-slate-400">Todos los eventos de citas ejecutados por este agente, más recientes primero.</p>
              </div>
              {qTl.isLoading ? <div className="p-5"><CardSkeleton height={140} /></div> : qTl.isError ? <div className="p-5"><CardError /></div> : (qTl.data?.eventos.length ?? 0) === 0 ? (
                <div className="p-5"><CardVacio mensaje="Sin eventos registrados" /></div>
              ) : (
                <>
                  <ul className="divide-y divide-slate-50">
                    {qTl.data!.eventos.map(e => (
                      <li key={e.id} className="px-5 py-2.5 flex items-start gap-3 text-xs">
                        <span className="font-mono text-[10px] text-slate-400 whitespace-nowrap pt-0.5">{String(e.creadoEn).slice(0, 16).replace('T', ' ')}</span>
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold whitespace-nowrap">{e.accion}</span>
                        <span className="text-slate-500 font-mono text-[10px] break-all pt-0.5">
                          {e.citaId ? `cita ${e.citaId.slice(0, 8)}…` : ''}
                          {e.despues ? ` → ${JSON.stringify(e.despues).slice(0, 110)}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="px-5 py-3 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-50">
                    <span>{qTl.data!.total} eventos · página {qTl.data!.page} de {qTl.data!.totalPages}</span>
                    <div className="flex gap-1.5">
                      <button disabled={paginaTl <= 1} onClick={() => setPaginaTl(p => p - 1)} className="px-2.5 py-1 rounded-lg border border-slate-200 font-semibold disabled:opacity-40 hover:bg-slate-50">←</button>
                      <button disabled={paginaTl >= (qTl.data!.totalPages || 1)} onClick={() => setPaginaTl(p => p + 1)} className="px-2.5 py-1 rounded-lg border border-slate-200 font-semibold disabled:opacity-40 hover:bg-slate-50">→</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
