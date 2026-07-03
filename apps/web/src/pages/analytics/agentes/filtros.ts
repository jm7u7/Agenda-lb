import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAnalyticsFiltros } from '../filtros';
import type { AgentesParams, AreaAgente } from '../../../api/analyticsAgentes';

/**
 * Filtros del módulo Desempeño de Agentes: reusa el estado global de Analytics
 * (período + sede, sincronizado a la URL) y le suma el filtro de ÁREA de agente
 * (param `areaAg`), también en la URL para que los drill-down hereden contexto.
 */
export function useAgentesFiltros() {
  const base = useAnalyticsFiltros();
  const [sp, setSp] = useSearchParams();

  const area: AreaAgente | '' = (sp.get('areaAg') as AreaAgente | null) ?? '';

  function setArea(a: AreaAgente | '') {
    setSp((prev) => {
      const q = new URLSearchParams(prev);
      if (a) q.set('areaAg', a);
      else q.delete('areaAg');
      return q;
    }, { replace: true });
  }

  const params: AgentesParams = useMemo(() => ({
    desde: base.filtros.desde,
    hasta: base.filtros.hasta,
    ...(base.filtros.sedeId ? { sedeId: base.filtros.sedeId } : {}),
    ...(area ? { area } : {}),
  }), [base.filtros, area]);

  return { ...base, area, setArea, params, search: sp.toString() };
}

export type AgentesFiltrosCtx = ReturnType<typeof useAgentesFiltros>;
