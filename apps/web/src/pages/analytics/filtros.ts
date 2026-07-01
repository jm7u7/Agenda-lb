import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns';

// ─── Presets de período ─────────────────────────────────────────────────────
const hoy = () => format(new Date(), 'yyyy-MM-dd');

export const PRESET_RANGES = [
  { label: 'Hoy', desde: hoy(), hasta: hoy() },
  { label: '7 días', desde: format(subDays(new Date(), 6), 'yyyy-MM-dd'), hasta: hoy() },
  { label: '30 días', desde: format(subDays(new Date(), 29), 'yyyy-MM-dd'), hasta: hoy() },
  { label: 'Este mes', desde: format(startOfMonth(new Date()), 'yyyy-MM-dd'), hasta: format(endOfMonth(new Date()), 'yyyy-MM-dd') },
  { label: 'Mes anterior', desde: format(startOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd'), hasta: format(endOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd') },
  { label: '3 meses', desde: format(subDays(new Date(), 89), 'yyyy-MM-dd'), hasta: hoy() },
];
const DEFAULT_PRESET = 2; // 30 días

export interface AnalyticsFiltros {
  desde: string;
  hasta: string;
  sedeId: string;
  unidadNegocioId: string;
  presetIdx: number; // -1 = rango custom
}

export interface AnalyticsParams {
  desde: string;
  hasta: string;
  sedeId?: string;
  unidadNegocioId?: string;
}

// Estado de filtros GLOBAL sincronizado a la URL (query string). Así el tablero y las
// sub-páginas de detalle comparten exactamente el mismo contexto: al navegar a un drill-down
// (`/analytics/:kpi?<search>`) y volver, los filtros se conservan sin estado externo.
export function useAnalyticsFiltros() {
  const [sp, setSp] = useSearchParams();

  const filtros: AnalyticsFiltros = useMemo(() => {
    const presetIdx = sp.has('preset') ? Number(sp.get('preset')) : DEFAULT_PRESET;
    const base = presetIdx >= 0 && PRESET_RANGES[presetIdx] ? PRESET_RANGES[presetIdx] : PRESET_RANGES[DEFAULT_PRESET];
    return {
      desde: sp.get('desde') || base.desde,
      hasta: sp.get('hasta') || base.hasta,
      sedeId: sp.get('sede') || '',
      unidadNegocioId: sp.get('unidad') || '',
      presetIdx,
    };
  }, [sp]);

  const params: AnalyticsParams = useMemo(() => ({
    desde: filtros.desde,
    hasta: filtros.hasta,
    ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}),
    ...(filtros.unidadNegocioId ? { unidadNegocioId: filtros.unidadNegocioId } : {}),
  }), [filtros]);

  function patch(next: Partial<{ desde: string; hasta: string; sede: string; unidad: string; preset: number }>) {
    setSp(prev => {
      const q = new URLSearchParams(prev);
      const set = (k: string, v: string | number | undefined | null) => {
        if (v === undefined || v === null || v === '') q.delete(k);
        else q.set(k, String(v));
      };
      if ('desde' in next) set('desde', next.desde);
      if ('hasta' in next) set('hasta', next.hasta);
      if ('sede' in next) set('sede', next.sede);
      if ('unidad' in next) set('unidad', next.unidad);
      if ('preset' in next) set('preset', next.preset);
      return q;
    }, { replace: true });
  }

  function aplicarPreset(idx: number) {
    const r = PRESET_RANGES[idx]!;
    patch({ preset: idx, desde: r.desde, hasta: r.hasta });
  }
  function setRangoCustom(campo: 'desde' | 'hasta', valor: string) {
    patch({ preset: -1, [campo]: valor } as { desde?: string; hasta?: string; preset: number });
  }
  function setSede(sedeId: string) { patch({ sede: sedeId }); }
  function setUnidad(unidadNegocioId: string) { patch({ unidad: unidadNegocioId }); }

  // Search string actual (para construir enlaces a drill-down y volver conservando contexto).
  const search = sp.toString();

  return { filtros, params, search, aplicarPreset, setRangoCustom, setSede, setUnidad };
}
