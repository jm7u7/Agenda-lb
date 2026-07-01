import { useQuery } from '@tanstack/react-query';
import { sedesApi } from '../../api';
import { analyticsApi } from '../../api/analytics';
import { cn } from '../../utils/cn';
import { PRESET_RANGES, type useAnalyticsFiltros } from './filtros';

type FiltrosCtx = ReturnType<typeof useAnalyticsFiltros>;

function Chip({ label, active, color, onClick }: { label: string; active: boolean; color?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all whitespace-nowrap flex items-center gap-1.5',
        active ? 'text-white border-transparent shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-limablue-400',
      )}
      style={active && color ? { backgroundColor: color } : active ? { backgroundColor: '#2563eb' } : {}}
    >
      {color && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: active ? 'rgba(255,255,255,0.75)' : color }} />}
      {label}
    </button>
  );
}

// Barra de filtros GLOBAL (sticky): período · sede · unidad. Un solo estado (URL) que
// TODO el tablero y los drill-down consumen.
export function GlobalFilterBar({ ctx }: { ctx: FiltrosCtx }) {
  const { filtros, aplicarPreset, setRangoCustom, setSede, setUnidad } = ctx;

  const { data: sedes } = useQuery({ queryKey: ['sedes-lista'], queryFn: () => sedesApi.listar(), staleTime: Infinity });
  const { data: unidades } = useQuery({ queryKey: ['analytics-unidades'], queryFn: () => analyticsApi.unidades(), staleTime: Infinity });

  const sedeNombre = sedes?.find(s => s.id === filtros.sedeId)?.nombre;
  const unidadNombre = unidades?.find(u => u.id === filtros.unidadNegocioId)?.nombre;
  const presetLabel = filtros.presetIdx >= 0 ? PRESET_RANGES[filtros.presetIdx]?.label : 'Personalizado';

  return (
    <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200">
      {/* Período */}
      <div className="px-6 py-3 flex items-center gap-3 overflow-x-auto">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider w-14 shrink-0">Período</span>
        <div className="flex gap-1.5">
          {PRESET_RANGES.map((p, i) => (
            <Chip key={p.label} label={p.label} active={filtros.presetIdx === i} onClick={() => aplicarPreset(i)} />
          ))}
        </div>
        <div className="flex items-center gap-1.5 ml-2 shrink-0">
          <input type="date" value={filtros.desde} onChange={e => setRangoCustom('desde', e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5" />
          <span className="text-xs text-slate-300">→</span>
          <input type="date" value={filtros.hasta} onChange={e => setRangoCustom('hasta', e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5" />
        </div>
      </div>

      {/* Sede + Unidad */}
      <div className="px-6 py-2.5 flex items-center gap-x-3 gap-y-2 flex-wrap border-t border-slate-100">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider w-14 shrink-0">Sede</span>
        <div className="flex gap-1.5 flex-wrap">
          <Chip label="Todas" active={filtros.sedeId === ''} onClick={() => setSede('')} />
          {(sedes ?? []).map(s => (
            <Chip key={s.id} label={s.nombre} color={s.color} active={filtros.sedeId === s.id} onClick={() => setSede(filtros.sedeId === s.id ? '' : s.id)} />
          ))}
        </div>
      </div>
      <div className="px-6 py-2.5 flex items-center gap-x-3 gap-y-2 flex-wrap border-t border-slate-100">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider w-14 shrink-0">Área</span>
        <div className="flex gap-1.5 flex-wrap">
          <Chip label="Todas" active={filtros.unidadNegocioId === ''} onClick={() => setUnidad('')} />
          {(unidades ?? []).map(u => (
            <Chip key={u.id} label={u.nombre} color={u.color} active={filtros.unidadNegocioId === u.id} onClick={() => setUnidad(filtros.unidadNegocioId === u.id ? '' : u.id)} />
          ))}
        </div>
      </div>

      {/* Resumen de filtros activos */}
      <div className="px-6 py-2 flex items-center gap-2 border-t border-slate-100 bg-slate-50/60 text-[11px] text-slate-500 overflow-x-auto">
        <span className="font-semibold text-slate-400 uppercase tracking-wider">Viendo</span>
        <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 font-medium whitespace-nowrap">{presetLabel}: {filtros.desde} → {filtros.hasta}</span>
        <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 font-medium whitespace-nowrap">Sede: {sedeNombre ?? 'Todas'}</span>
        <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 font-medium whitespace-nowrap">Área: {unidadNombre ?? 'Todas'}</span>
      </div>
    </div>
  );
}
