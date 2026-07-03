import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { analyticsApi } from '../api/analytics';
import { exportToExcel } from './analytics/ui';
import { useAnalyticsFiltros } from './analytics/filtros';
import { GlobalFilterBar } from './analytics/GlobalFilterBar';
import { HeroFunnel } from './analytics/HeroFunnel';
import { KPIS, GRUPOS, type KpiDef } from './analytics/kpis';

// Acento por tema (encoda el área, no decora): operación=azul, calidad=verde salud,
// comercial=rosa, sedes=ámbar, agentes=violeta.
const GRUPO_ACENTO: Record<string, string> = {
  'Operación': '#3b82f6',
  'Calidad de agenda': '#10b981',
  'Comercial': '#ec4899',
  'Sedes': '#f59e0b',
  'Agentes': '#8b5cf6',
};

export function AnalyticsPage() {
  const usuario = useAuthStore(s => s.usuario);
  const tiene = useAuthStore(s => s.tiene);
  const isCoordinadora = ['admin', 'coordinadora_sedes'].includes(usuario?.rol ?? '');
  const navigate = useNavigate();
  const ctx = useAnalyticsFiltros();
  const { params, search } = ctx;

  // Para el export global del período (mismo dato que las tarjetas).
  const { data: kpis } = useQuery({ queryKey: ['analytics-kpis', params], queryFn: () => analyticsApi.kpis(params), staleTime: 60_000, enabled: isCoordinadora });

  if (!isCoordinadora) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <p className="text-slate-600 font-semibold">Acceso restringido</p>
          <p className="text-slate-400 text-sm mt-1">Solo coordinadoras y administradores.</p>
        </div>
      </div>
    );
  }

  function abrir(kpi: KpiDef) {
    navigate({ pathname: `/analytics/${kpi.key}`, search: search ? `?${search}` : '' });
  }

  function exportarResumen() {
    exportToExcel(`analytics_${params.desde}_${params.hasta}.xlsx`, [{
      name: 'Resumen',
      data: kpis ? [{
        'Desde': params.desde, 'Hasta': params.hasta,
        'Total citas': kpis.totalCitas, 'Completadas': kpis.completadas, 'No-shows': kpis.noShow, 'Canceladas': kpis.canceladas,
        'Llegaron': kpis.llegaron, 'Horas atendidas': kpis.horasAtendidas,
        'Tasa completadas %': kpis.tasaCompletadas, 'Tasa no-show %': kpis.tasaNoShow, 'Tasa canceladas %': kpis.tasaCanceladas, 'Citas propias %': kpis.tasaPropios,
      }] : [],
    }]);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
      {/* Encabezado */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-xl font-black text-slate-800">Tablero de Analytics</h1>
          <p className="text-xs text-slate-400 mt-0.5">Vista general · toca cualquier tarjeta para ver el detalle</p>
        </div>
        <button onClick={exportarResumen} className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
          Exportar resumen
        </button>
      </div>

      {/* Filtros globales (sticky) */}
      <div className="flex-1 overflow-y-auto">
        <GlobalFilterBar ctx={ctx} />

        <div className="p-6 space-y-9">
          {/* HERO — embudo de agendamiento */}
          <HeroFunnel params={params} />

          {/* Grid bento agrupado por tema */}
          {GRUPOS.map(grupo => {
            const items = KPIS.filter(k => k.grupo === grupo);
            if (items.length === 0) return null;
            return (
              <section key={grupo}>
                <div className="flex items-center gap-3 mb-3.5 px-1">
                  <span className="h-3.5 w-1 rounded-full" style={{ background: GRUPO_ACENTO[grupo] }} />
                  <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.18em]">{grupo}</h2>
                  <span className="flex-1 h-px bg-gradient-to-r from-slate-200 to-transparent" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 auto-rows-fr">
                  {items.map(kpi => (
                    <DashboardCardWrapper key={kpi.key} kpi={kpi} params={params} onOpen={() => abrir(kpi)} />
                  ))}
                </div>
              </section>
            );
          })}

          {/* Desempeño de Agentes (módulo con sub-páginas propias; gate por permiso) */}
          {tiene('analytics.agentes') && (
            <section>
              <div className="flex items-center gap-3 mb-3.5 px-1">
                <span className="h-3.5 w-1 rounded-full" style={{ background: GRUPO_ACENTO['Agentes'] }} />
                <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.18em]">Agentes</h2>
                <span className="flex-1 h-px bg-gradient-to-r from-slate-200 to-transparent" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 auto-rows-fr">
                <AgentesEntradaCard params={params} onOpen={destino => navigate({ pathname: destino, search: search ? `?${search}` : '' })} />
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// Wrapper liviano: usa DashboardCard de ui con el Preview del KPI dentro.
import { DashboardCard } from './analytics/ui';
import type { AnalyticsParams } from './analytics/filtros';
import { agentesApi } from '../api/analyticsAgentes';
import { fmtTasa } from './analytics/agentes/ui';

function DashboardCardWrapper({ kpi, params, onOpen }: { kpi: KpiDef; params: AnalyticsParams; onOpen: () => void }) {
  const Preview = kpi.Preview;
  return (
    <DashboardCard titulo={kpi.titulo} descripcion={kpi.descripcion} icon={kpi.icon} onClick={onOpen} span={kpi.span} footer={<span className="group-hover:text-limablue-600 transition-colors">Ver detalle →</span>}>
      <Preview params={params} />
    </DashboardCard>
  );
}

// Tarjeta de entrada al módulo Desempeño de Agentes (mini preview con totales).
function AgentesEntradaCard({ params, onOpen }: { params: AnalyticsParams; onOpen: (destino: string) => void }) {
  const q = useQuery({
    queryKey: ['agentes-resumen', { desde: params.desde, hasta: params.hasta, ...(params.sedeId ? { sedeId: params.sedeId } : {}) }],
    queryFn: () => agentesApi.resumen({ desde: params.desde, hasta: params.hasta, sedeId: params.sedeId }),
    staleTime: 60_000,
  });
  const t = q.data?.totales;
  const conDatos = q.data?.agentes.filter(a => !a.sinDatos).length ?? 0;
  return (
    <DashboardCard
      titulo="Desempeño de Agentes"
      descripcion="Contact Center y Recepción: volumen, show rate, recitación y score"
      span={2}
      icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4z" /></svg>}
      onClick={() => onOpen('/analytics/agentes')}
      footer={<span className="group-hover:text-limablue-600 transition-colors">Resumen · Comparativa · Drill-down →</span>}
    >
      {q.isLoading ? <div className="animate-pulse rounded-xl bg-slate-100 h-[72px]" /> : (
        <div className="grid grid-cols-4 gap-3 text-center">
          {[
            ['Agendamientos', t ? String(t.agendamientos) : '—'],
            ['Show rate', t ? fmtTasa(t.showRate) : '—'],
            ['Recitación', t ? fmtTasa(t.tasaRecitacion) : '—'],
            ['Agentes activos', q.data ? String(conDatos) : '—'],
          ].map(([lbl, val]) => (
            <div key={lbl} className="rounded-xl bg-slate-50 py-2.5">
              <p className={`text-lg font-black tabular-nums ${val === '—' ? 'text-slate-300' : 'text-slate-700'}`}>{val}</p>
              <p className="text-[10px] text-slate-400 font-semibold">{lbl}</p>
            </div>
          ))}
        </div>
      )}
    </DashboardCard>
  );
}
