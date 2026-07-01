import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useAnalyticsFiltros } from './filtros';
import { GlobalFilterBar } from './GlobalFilterBar';
import { KPI_MAP } from './kpis';

// Sub-página de detalle de un KPI (`/analytics/:kpi`). Consume el MISMO endpoint que la
// tarjeta del tablero (vía el componente Detalle del registro) y HEREDA los filtros globales
// desde la URL. "← Volver al tablero" conserva el contexto (misma query string).
export function AnalyticsDetallePage() {
  const usuario = useAuthStore(s => s.usuario);
  const isCoordinadora = ['admin', 'coordinadora_sedes'].includes(usuario?.rol ?? '');
  const { kpi: kpiKey } = useParams<{ kpi: string }>();
  const navigate = useNavigate();
  const ctx = useAnalyticsFiltros();
  const { params, search } = ctx;

  if (!isCoordinadora) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <p className="text-slate-600 font-semibold">Acceso restringido</p>
        </div>
      </div>
    );
  }

  const def = kpiKey ? KPI_MAP.get(kpiKey) : undefined;
  const volver = () => navigate({ pathname: '/analytics', search: search ? `?${search}` : '' });

  if (!def) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 gap-3">
        <p className="text-slate-500 text-sm">Ese indicador no existe.</p>
        <button onClick={volver} className="text-limablue-600 text-sm font-semibold">← Volver al tablero</button>
      </div>
    );
  }

  const Detalle = def.Detalle;
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
      {/* Encabezado con volver */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3 flex-shrink-0">
        <button onClick={volver} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-all" title="Volver al tablero">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <span className="w-9 h-9 rounded-xl bg-slate-50 flex items-center justify-center text-limablue-600 shrink-0">{def.icon}</span>
        <div>
          <h1 className="text-lg font-black text-slate-800">{def.titulo}</h1>
          <p className="text-xs text-slate-400">{def.descripcion}</p>
        </div>
        <button onClick={volver} className="ml-auto text-xs font-semibold text-slate-500 hover:text-limablue-600">← Volver al tablero</button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <GlobalFilterBar ctx={ctx} />
        <div className="p-6">
          <Detalle params={params} />
        </div>
      </div>
    </div>
  );
}
