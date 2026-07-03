import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { cn } from '../../../utils/cn';
import { AREA_COLOR, AREA_LABEL, type AreaAgente, type Tasa } from '../../../api/analyticsAgentes';

// ─── Formato: "sin datos" (null) SIEMPRE se distingue de 0 ───────────────────
export const fmtTasa = (v: Tasa) => (v === null ? '—' : `${v}%`);
export const fmtNum = (v: number | null) => (v === null ? '—' : new Intl.NumberFormat('es-PE').format(v));

// ─── Badge de área ────────────────────────────────────────────────────────────
export function AreaBadge({ area, compact = false }: { area: AreaAgente; compact?: boolean }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full font-semibold', compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]')}
      style={{ backgroundColor: `${AREA_COLOR[area]}18`, color: AREA_COLOR[area] }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: AREA_COLOR[area] }} />
      {compact ? (area === 'CONTACT_CENTER' ? 'CC' : area === 'RECEPCION' ? 'Recep.' : 'Otro') : AREA_LABEL[area]}
    </span>
  );
}

// ─── Avatar con iniciales ─────────────────────────────────────────────────────
export function AgenteAvatar({ nombre, color, size = 'md' }: { nombre: string; color: string; size?: 'sm' | 'md' | 'lg' }) {
  const iniciales = nombre.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('');
  const cls = size === 'lg' ? 'w-12 h-12 text-base' : size === 'sm' ? 'w-6 h-6 text-[10px]' : 'w-9 h-9 text-xs';
  return (
    <span className={cn('rounded-full text-white font-bold flex items-center justify-center shrink-0', cls)} style={{ backgroundColor: color }}>
      {iniciales}
    </span>
  );
}

// ─── Anillo de score (gauge circular) ─────────────────────────────────────────
export function ScoreRing({ score, size = 64 }: { score: number | null; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const pctScore = score === null ? 0 : Math.max(0, Math.min(100, score));
  const color = score === null ? '#cbd5e1' : score >= 70 ? '#10b981' : score >= 45 ? '#f59e0b' : '#ef4444';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={score === null ? 'Sin datos suficientes para score' : `Score compuesto: ${score}/100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={5} strokeDasharray={score === null ? '3 4' : undefined} />
        {score !== null && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round"
            strokeDasharray={`${(pctScore / 100) * c} ${c}`} className="transition-all duration-500"
          />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-black tabular-nums" style={{ color: score === null ? '#94a3b8' : '#1e293b', fontSize: size * 0.3 }}>
        {score === null ? '—' : score}
      </span>
    </div>
  );
}

// ─── Fila de métrica comparable (mini barra relativa al máximo del grupo) ─────
// `mejor` = realce sutil del líder de la fila; `alerta` = bajo umbral crítico.
export function FilaMetrica({
  label, valor, texto, max, color = '#3b82f6', mejor = false, alerta = false,
}: {
  label: string;
  valor: number | null;   // magnitud para la barra (null = sin datos)
  texto: string;          // lo que se muestra (ya formateado, "—" si sin datos)
  max: number;            // máximo del grupo comparado (para el largo relativo)
  color?: string;
  mejor?: boolean;
  alerta?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5" title={alerta ? 'Bajo el umbral crítico' : undefined}>
      <span className="text-[10px] text-slate-500 truncate w-[4.5rem] shrink-0">{label}</span>
      <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden min-w-0">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: valor === null || max <= 0 ? 0 : `${Math.min(100, (valor / max) * 100)}%`, backgroundColor: alerta ? '#ef4444' : color }}
        />
      </div>
      <span className={cn('text-[11px] font-bold tabular-nums w-11 text-right shrink-0 flex items-center justify-end gap-0.5', alerta ? 'text-red-500' : valor === null ? 'text-slate-300' : 'text-slate-700')}>
        {mejor && <span className="text-amber-400 text-[9px]" title="Mejor del grupo">●</span>}
        {texto}
      </span>
    </div>
  );
}

// ─── Sparkline (tendencia de las últimas semanas) ─────────────────────────────
export function Sparkline({ puntos, color = '#3b82f6', height = 28 }: { puntos: number[]; color?: string; height?: number }) {
  if (puntos.length === 0) return <div className="text-[10px] text-slate-300 text-center py-2">sin actividad</div>;
  const w = 100;
  const max = Math.max(...puntos, 1);
  const paso = puntos.length > 1 ? w / (puntos.length - 1) : 0;
  const coords = puntos.map((v, i) => `${puntos.length === 1 ? w / 2 : i * paso},${height - 3 - (v / max) * (height - 6)}`);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <polyline points={coords.join(' ')} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {puntos.length === 1 && <circle cx={w / 2} cy={height - 3 - (puntos[0]! / max) * (height - 6)} r={2} fill={color} />}
    </svg>
  );
}

// ─── FLIP: reordenamiento animado de tarjetas ─────────────────────────────────
// Mide la posición de cada hijo (por key) antes y después del reorden y anima la
// diferencia con transform. Sin dependencias nuevas.
export function useFlip<T extends HTMLElement>(deps: unknown[]) {
  const contRef = useRef<T | null>(null);
  const prevRects = useRef(new Map<string, DOMRect>());

  useLayoutEffect(() => {
    const cont = contRef.current;
    if (!cont) return;
    const hijos = [...cont.children] as HTMLElement[];
    for (const el of hijos) {
      const key = el.dataset.flipKey;
      if (!key) continue;
      const prev = prevRects.current.get(key);
      const ahora = el.getBoundingClientRect();
      if (prev && (prev.left !== ahora.left || prev.top !== ahora.top)) {
        el.style.transition = 'none';
        el.style.transform = `translate(${prev.left - ahora.left}px, ${prev.top - ahora.top}px)`;
        requestAnimationFrame(() => {
          el.style.transition = 'transform 350ms cubic-bezier(.4,0,.2,1)';
          el.style.transform = '';
        });
      }
      prevRects.current.set(key, ahora);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return contRef;
}

// ─── Estado vacío elegante ────────────────────────────────────────────────────
export function EstadoVacio({ titulo, mensaje, children }: { titulo: string; mensaje: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
        <svg className="w-7 h-7 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6-4a3 3 0 11-3-3m-9 3a3 3 0 10-3-3" />
        </svg>
      </div>
      <p className="text-sm font-bold text-slate-600">{titulo}</p>
      <p className="text-xs text-slate-400 mt-1 max-w-xs">{mensaje}</p>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
