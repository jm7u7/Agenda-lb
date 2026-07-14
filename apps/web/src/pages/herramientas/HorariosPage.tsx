// Horarios del personal — HERRAMIENTA UNIFICADA (admin + coordinadora).
// Una sola verdad sobre "cuándo trabaja cada persona", en dos vistas del mismo modelo:
//   · Semana tipo      → turno base semanal permanente (capa 1: HorarioProfesional)
//   · Ajustes por fecha → entrada 8/9 de días concretos + presencia en días especiales
//                         (capa 2: override por fecha — afecta agenda Y reservas)
// Ambas capas las resuelve el backend con `turnosDelDia`; lo que se ve aquí es lo que
// el motor de reservas permite. Las ausencias puntuales van en Permisos/Bloqueos.

import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { cn } from '../../utils/cn';
import { SemanaTipoContent } from './HorariosPersonalPage';
import { AjustesFechaContent } from './HorariosEntradaPage';

const TABS = [
  { id: 'semana', label: 'Semana tipo', hint: 'Días y horas permanentes de cada persona' },
  { id: 'fechas', label: 'Ajustes por fecha', hint: 'Entrada 8/9 de días concretos y días especiales' },
] as const;
type TabId = typeof TABS[number]['id'];

export function HorariosPage() {
  const navigate = useNavigate();
  const puedeGestionar = useAuthStore(s => s.isCoordinadora()); // admin + coordinadora_sedes
  const [params, setParams] = useSearchParams();
  const tab: TabId = params.get('tab') === 'fechas' ? 'fechas' : 'semana';

  if (!puedeGestionar) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50 text-slate-400 text-sm">
        Solo la Coordinadora de Sedes (y el admin) pueden gestionar los horarios del personal.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3 sticky top-0 z-20">
        <button onClick={() => navigate('/herramientas')} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-all" title="Volver a Herramientas">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-400 to-cyan-600 flex items-center justify-center shrink-0"><span className="text-white text-lg">🗓️</span></div>
        <div className="flex-1">
          <h1 className="text-base font-bold text-slate-900">Horarios del personal</h1>
          <p className="text-xs text-slate-500">{TABS.find(t => t.id === tab)?.hint}</p>
        </div>
        {/* Tabs */}
        <div className="flex bg-slate-100 rounded-lg p-0.5">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setParams({ tab: t.id }, { replace: true })}
              className={cn('px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all',
                tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'semana' ? <SemanaTipoContent /> : <AjustesFechaContent />}
    </div>
  );
}
