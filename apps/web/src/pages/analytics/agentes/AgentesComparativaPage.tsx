import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../../stores/authStore';
import {
  agentesApi, AREA_COLOR, AREA_LABEL,
  type AgenteKpis, type AreaAgente, type Tasa,
} from '../../../api/analyticsAgentes';
import { CardSkeleton, CardError, fmtInt } from '../ui';
import { useAgentesFiltros } from './filtros';
import { AgentesFilterBar } from './AgentesFilterBar';
import { AgenteAvatar, AreaBadge, FilaMetrica, ScoreRing, Sparkline, EstadoVacio, fmtTasa, useFlip } from './ui';
import { cn } from '../../../utils/cn';

const MAX_AGENTES = 8;
type OrdenCard = 'score' | 'volumen' | 'showRate';

// Métrica de una fila comparable: cómo se extrae, formatea y evalúa.
interface DefFila {
  key: string;
  label: string;
  valor: (a: AgenteKpis) => number | null;
  texto: (a: AgenteKpis) => string;
  color: string;
  soloArea?: AreaAgente;
  mejorEsMenor?: boolean;
  alerta?: (a: AgenteKpis, umbral: number) => boolean;
}

const FILAS: DefFila[] = [
  { key: 'agendadas', label: 'Agendadas', valor: a => (a.sinDatos ? null : a.volumen.agendamientos), texto: a => (a.sinDatos ? '—' : fmtInt(a.volumen.agendamientos)), color: '#3b82f6' },
  { key: 'show', label: 'Show rate', valor: a => a.calidad.showRate, texto: a => fmtTasa(a.calidad.showRate), color: '#10b981', alerta: (a, u) => a.calidad.showRate !== null && a.calidad.showRate < u },
  { key: 'repro', label: 'Reprogr.', valor: a => (a.sinDatos ? null : a.gestion.reprogramaciones), texto: a => (a.sinDatos ? '—' : String(a.gestion.reprogramaciones)), color: '#f59e0b', mejorEsMenor: true },
  { key: 'cancel', label: 'Cancel.', valor: a => (a.sinDatos ? null : a.gestion.cancelacionesEjecutadas), texto: a => (a.sinDatos ? '—' : String(a.gestion.cancelacionesEjecutadas)), color: '#f87171', mejorEsMenor: true },
  { key: 'recita', label: 'Recitación', valor: a => a.conversion.tasaRecitacion, texto: a => fmtTasa(a.conversion.tasaRecitacion), color: '#0ea5e9', soloArea: 'RECEPCION' },
  { key: 'combo', label: 'Combinados', valor: a => a.conversion.tasaBloquesCombinados, texto: a => fmtTasa(a.conversion.tasaBloquesCombinados), color: '#8b5cf6', soloArea: 'CONTACT_CENTER' },
];

function TarjetaAgente({ a, filas, maximos, mejores, umbral, onOpen }: {
  a: AgenteKpis;
  filas: DefFila[];
  maximos: Map<string, number>;
  mejores: Map<string, Set<string>>;
  umbral: number;
  onOpen: () => void;
}) {
  const ultimas4 = a.semanas.slice(-4).map(s => s.agendamientos);
  return (
    <div
      data-flip-key={a.agenteId}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}
      className="snap-center shrink-0 w-[168px] lg:w-auto flex flex-col rounded-2xl border border-slate-100 bg-white shadow-sm p-3.5 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-slate-200/70 hover:border-slate-200 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-limablue-400"
    >
      {/* Cabecera */}
      <div className="flex flex-col items-center text-center gap-1.5 pb-3 border-b border-slate-50">
        <AgenteAvatar nombre={a.nombre} color={AREA_COLOR[a.area]} size="md" />
        <p className="text-xs font-bold text-slate-700 leading-tight line-clamp-2 min-h-[2rem]">{a.nombre}</p>
        <div className="flex flex-col items-center gap-1">
          <AreaBadge area={a.area} compact />
          <span className="text-[9px] text-slate-400 truncate max-w-[9rem]">{a.sede?.nombre ?? 'Multi-sede'}</span>
        </div>
        <ScoreRing score={a.score} size={58} />
        <span className="text-[9px] text-slate-400 -mt-1">score</span>
      </div>

      {/* Métricas comparables */}
      <div className="flex flex-col gap-2 py-3 flex-1">
        {a.sinDatos ? (
          <p className="text-[10px] text-slate-300 text-center py-4">Sin datos en el período</p>
        ) : filas.map(f => (
          <FilaMetrica
            key={f.key}
            label={f.label}
            valor={f.soloArea && a.area !== f.soloArea ? null : f.valor(a)}
            texto={f.soloArea && a.area !== f.soloArea ? 'n/a' : f.texto(a)}
            max={maximos.get(f.key) ?? 0}
            color={f.color}
            mejor={mejores.get(f.key)?.has(a.agenteId) ?? false}
            alerta={f.alerta ? f.alerta(a, umbral) : false}
          />
        ))}
      </div>

      {/* Pie: sparkline 4 semanas */}
      <div className="pt-2 border-t border-slate-50">
        <p className="text-[9px] text-slate-400 mb-1">Agendadas · últimas 4 semanas</p>
        <Sparkline puntos={ultimas4} color={AREA_COLOR[a.area]} />
      </div>
    </div>
  );
}

export function AgentesComparativaPage() {
  const tiene = useAuthStore(s => s.tiene);
  const navigate = useNavigate();
  const ctx = useAgentesFiltros();
  const { params, search } = ctx;
  const [sp, setSp] = useSearchParams();
  const [orden, setOrden] = useState<OrdenCard>('score');

  // Selección de agentes en la URL (ids=), para compartir/volver con contexto.
  const seleccion = useMemo(() => (sp.get('ids') ?? '').split(',').filter(Boolean), [sp]);
  function setSeleccion(ids: string[]) {
    setSp(prev => {
      const q = new URLSearchParams(prev);
      if (ids.length) q.set('ids', ids.join(','));
      else q.delete('ids');
      return q;
    }, { replace: true });
  }

  const qLista = useQuery({ queryKey: ['agentes-lista'], queryFn: () => agentesApi.lista(), staleTime: 300_000, enabled: tiene('analytics.agentes') });
  const qComp = useQuery({
    queryKey: ['agentes-comparativa', params, seleccion],
    queryFn: () => agentesApi.comparativa(params, seleccion),
    staleTime: 60_000,
    enabled: tiene('analytics.agentes') && seleccion.length > 0,
  });

  const flipRef = useFlip<HTMLDivElement>([qComp.data, orden]);

  const cardsOrdenadas = useMemo(() => {
    const lista = [...(qComp.data?.agentes ?? [])];
    const val = (a: AgenteKpis): number => {
      const v: Tasa = orden === 'score' ? a.score : orden === 'volumen' ? a.volumen.agendamientos : a.calidad.showRate;
      return v === null ? -1 : v; // sin datos al final
    };
    lista.sort((a, b) => val(b) - val(a));
    return lista;
  }, [qComp.data, orden]);

  // Máximos por fila (para el largo relativo) y "mejor del grupo" por fila.
  const { maximos, mejores } = useMemo(() => {
    const maximos = new Map<string, number>();
    const mejores = new Map<string, Set<string>>();
    for (const f of FILAS) {
      const conValor = cardsOrdenadas
        .filter(a => !a.sinDatos && (!f.soloArea || a.area === f.soloArea))
        .map(a => ({ id: a.agenteId, v: f.valor(a) }))
        .filter((x): x is { id: string; v: number } => x.v !== null);
      if (conValor.length === 0) continue;
      maximos.set(f.key, Math.max(...conValor.map(x => x.v)));
      const objetivo = f.mejorEsMenor ? Math.min(...conValor.map(x => x.v)) : Math.max(...conValor.map(x => x.v));
      // El realce solo tiene sentido si hay comparación real (≥2 con valor y no todos iguales).
      if (conValor.length >= 2 && new Set(conValor.map(x => x.v)).size > 1) {
        mejores.set(f.key, new Set(conValor.filter(x => x.v === objetivo).map(x => x.id)));
      }
    }
    return { maximos, mejores };
  }, [cardsOrdenadas]);

  if (!tiene('analytics.agentes')) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center"><p className="text-4xl mb-3">🔒</p><p className="text-slate-600 font-semibold">Acceso restringido</p></div>
      </div>
    );
  }

  const lista = qLista.data ?? [];
  const porArea = (area: AreaAgente) => lista.filter(a => a.area === area).map(a => a.id).slice(0, MAX_AGENTES);

  function toggle(id: string) {
    if (seleccion.includes(id)) setSeleccion(seleccion.filter(x => x !== id));
    else if (seleccion.length < MAX_AGENTES) setSeleccion([...seleccion, id]);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3 flex-shrink-0">
        <button onClick={() => navigate({ pathname: '/analytics/agentes', search: search ? `?${search}` : '' })} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-all" title="Volver al resumen">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div>
          <h1 className="text-lg font-black text-slate-800">Comparativa de agentes</h1>
          <p className="text-xs text-slate-400">Hasta {MAX_AGENTES} agentes lado a lado · el punto ámbar marca al mejor del grupo en cada métrica</p>
        </div>
        <div className="ml-auto flex rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold">
          {([['score', 'Score'], ['volumen', 'Volumen'], ['showRate', 'Show rate']] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setOrden(k)} className={cn('px-3 py-1.5 transition-all', orden === k ? 'bg-limablue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50')}>{lbl}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <AgentesFilterBar ctx={ctx} />

        <div className="p-6 space-y-5">
          {/* Selector de agentes */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <p className="text-xs font-bold text-slate-600">
                Agentes seleccionados <span className={cn('tabular-nums', seleccion.length >= MAX_AGENTES ? 'text-amber-600' : 'text-slate-400')}>({seleccion.length}/{MAX_AGENTES})</span>
              </p>
              <div className="flex gap-1.5 flex-wrap">
                <button onClick={() => setSeleccion(porArea('CONTACT_CENTER'))} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-violet-200 text-violet-600 hover:bg-violet-50">Todo Contact Center</button>
                <button onClick={() => setSeleccion(porArea('RECEPCION'))} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-sky-200 text-sky-600 hover:bg-sky-50">Toda Recepción</button>
                {seleccion.length > 0 && <button onClick={() => setSeleccion([])} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-slate-200 text-slate-400 hover:bg-slate-50">Limpiar</button>}
              </div>
            </div>
            {qLista.isLoading ? <CardSkeleton height={40} /> : (
              <div className="flex gap-1.5 flex-wrap">
                {lista.map(a => {
                  const activo = seleccion.includes(a.id);
                  const lleno = !activo && seleccion.length >= MAX_AGENTES;
                  return (
                    <button
                      key={a.id}
                      onClick={() => toggle(a.id)}
                      disabled={lleno}
                      title={lleno ? `Máximo ${MAX_AGENTES} agentes` : `${AREA_LABEL[a.area]}${a.sedeAsignada ? ` · ${a.sedeAsignada.nombre}` : ''}`}
                      className={cn(
                        'flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all',
                        activo ? 'text-white border-transparent shadow-sm' : lleno ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed' : 'bg-white text-slate-600 border-slate-200 hover:border-limablue-400',
                      )}
                      style={activo ? { backgroundColor: AREA_COLOR[a.area] } : {}}
                    >
                      <AgenteAvatar nombre={a.nombre} color={activo ? 'rgba(255,255,255,0.3)' : AREA_COLOR[a.area]} size="sm" />
                      {a.nombre}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tarjetas comparativas */}
          {seleccion.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
              <EstadoVacio titulo="Elige a quién comparar" mensaje="Selecciona hasta 8 agentes con los chips de arriba, o usa los botones rápidos por área.">
                <button onClick={() => setSeleccion(porArea('CONTACT_CENTER'))} className="px-4 py-2 bg-limablue-600 text-white text-xs font-semibold rounded-xl hover:bg-limablue-700">Comparar todo Contact Center</button>
              </EstadoVacio>
            </div>
          ) : qComp.isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
              {seleccion.map(id => <div key={id} className="rounded-2xl border border-slate-100 bg-white h-[380px] animate-pulse" />)}
            </div>
          ) : qComp.isError ? (
            <div className="bg-white rounded-2xl border border-slate-100 p-6"><CardError /></div>
          ) : (
            <div
              ref={flipRef}
              className="flex lg:grid gap-3 overflow-x-auto lg:overflow-visible snap-x snap-mandatory pb-2"
              style={{ gridTemplateColumns: `repeat(${cardsOrdenadas.length}, minmax(0, 1fr))` }}
            >
              {cardsOrdenadas.map(a => (
                <TarjetaAgente
                  key={a.agenteId}
                  a={a}
                  filas={FILAS}
                  maximos={maximos}
                  mejores={mejores}
                  umbral={qComp.data!.umbralShowRateCritico}
                  onOpen={() => navigate({ pathname: `/analytics/agentes/${a.agenteId}`, search: search ? `?${search}` : '' })}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
