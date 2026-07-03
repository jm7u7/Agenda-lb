import { useQuery } from '@tanstack/react-query';
import { sedesApi } from '../../../api';
import { AREA_COLOR, AREA_LABEL } from '../../../api/analyticsAgentes';
import { Chip } from '../GlobalFilterBar';
import { PRESET_RANGES } from '../filtros';
import type { AgentesFiltrosCtx } from './filtros';

/**
 * Barra de filtros sticky del módulo Desempeño de Agentes. Mismo lenguaje visual
 * que la GlobalFilterBar de Analytics (mismos Chip/espaciados/sticky), con la fila
 * "Área" referida al ÁREA DE AGENTE (Contact Center / Recepción), no a la unidad.
 */
export function AgentesFilterBar({ ctx }: { ctx: AgentesFiltrosCtx }) {
  const { filtros, aplicarPreset, setRangoCustom, setSede, area, setArea } = ctx;
  const { data: sedes } = useQuery({ queryKey: ['sedes-lista'], queryFn: () => sedesApi.listar(), staleTime: Infinity });

  const sedeNombre = sedes?.find(s => s.id === filtros.sedeId)?.nombre;
  const presetLabel = filtros.presetIdx >= 0 ? PRESET_RANGES[filtros.presetIdx]?.label : 'Personalizado';

  return (
    <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200">
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
          <Chip label="Todas" active={area === ''} onClick={() => setArea('')} />
          {(['CONTACT_CENTER', 'RECEPCION'] as const).map(a => (
            <Chip key={a} label={AREA_LABEL[a]} color={AREA_COLOR[a]} active={area === a} onClick={() => setArea(area === a ? '' : a)} />
          ))}
        </div>
      </div>

      <div className="px-6 py-2 flex items-center gap-2 border-t border-slate-100 bg-slate-50/60 text-[11px] text-slate-500 overflow-x-auto">
        <span className="font-semibold text-slate-400 uppercase tracking-wider">Viendo</span>
        <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 font-medium whitespace-nowrap">{presetLabel}: {filtros.desde} → {filtros.hasta}</span>
        <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 font-medium whitespace-nowrap">Sede: {sedeNombre ?? 'Todas'}</span>
        <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 font-medium whitespace-nowrap">Área: {area ? AREA_LABEL[area] : 'Todas'}</span>
      </div>
    </div>
  );
}
