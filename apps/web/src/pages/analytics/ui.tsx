import type { ReactNode } from 'react';
import * as XLSX from 'xlsx';
import { cn } from '../../utils/cn';

// ─── Formato de números (centralizado) ──────────────────────────────────────
export const fmtInt = (n: number) => new Intl.NumberFormat('es-PE').format(Math.round(n));
export const fmtPct = (n: number) => `${n}%`;

export function deltaTexto(v: number | null | undefined) {
  if (v === null || v === undefined) return null;
  return v > 0 ? `+${v}%` : `${v}%`;
}
export function deltaColor(v: number | null | undefined, invertido = false) {
  if (v === null || v === undefined) return 'text-slate-400';
  const positivo = invertido ? v < 0 : v > 0;
  return positivo ? 'text-emerald-600' : 'text-red-500';
}

export function exportToExcel(filename: string, sheets: { name: string; data: Record<string, unknown>[] }[]) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.data);
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  XLSX.writeFile(wb, filename);
}

// ─── StatCard (fila HERO) ────────────────────────────────────────────────────
export function StatCard({
  label, value, suffix, delta, deltaInvertido = false, loading = false, accent = false,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  delta?: number | null;
  deltaInvertido?: boolean;
  loading?: boolean;
  accent?: boolean;
}) {
  if (loading) {
    return <div className="rounded-2xl border border-slate-100 bg-white h-[104px] animate-pulse" />;
  }
  const d = deltaTexto(delta);
  return (
    <div className={cn(
      'rounded-2xl border p-5 transition-shadow',
      accent ? 'border-transparent bg-gradient-to-br from-limablue-600 to-limablue-800 text-white shadow-lg shadow-limablue-200'
             : 'border-slate-100 bg-white shadow-sm',
    )}>
      <p className={cn('text-[11px] font-semibold uppercase tracking-wider', accent ? 'text-limablue-100' : 'text-slate-500')}>{label}</p>
      <p className={cn('mt-1 font-black tabular-nums leading-none', accent ? 'text-white' : 'text-slate-800', 'text-[2rem]')}>
        {value}{suffix && <span className={cn('ml-1 text-base font-bold', accent ? 'text-limablue-200' : 'text-slate-400')}>{suffix}</span>}
      </p>
      {d !== null
        ? <p className={cn('mt-2 text-xs font-semibold', accent ? 'text-limablue-100' : deltaColor(delta, deltaInvertido))}>{d} <span className={accent ? 'text-limablue-200 font-normal' : 'text-slate-400 font-normal'}>vs período anterior</span></p>
        : <p className="mt-2 text-xs text-transparent select-none">·</p>}
    </div>
  );
}

// ─── DashboardCard (tarjeta de resumen clickeable → drill-down) ──────────────
export function DashboardCard({
  titulo, descripcion, icon, onClick, children, span = 1, footer,
}: {
  titulo: string;
  descripcion?: string;
  icon?: ReactNode;
  onClick?: () => void;
  children: ReactNode;
  span?: 1 | 2;
  footer?: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => { if (onClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(); } }}
      className={cn(
        'group flex flex-col text-left rounded-2xl border border-slate-100 bg-white shadow-sm p-5 transition-all duration-200',
        'hover:-translate-y-0.5 hover:shadow-xl hover:shadow-slate-200/70 hover:border-slate-200 cursor-pointer',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-limablue-400',
        span === 2 ? 'md:col-span-2' : '',
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {icon && <span className="w-8 h-8 rounded-xl bg-slate-50 flex items-center justify-center text-slate-500 shrink-0 group-hover:bg-limablue-50 group-hover:text-limablue-600 transition-colors">{icon}</span>}
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-800 truncate">{titulo}</h3>
            {descripcion && <p className="text-xs text-slate-400 truncate">{descripcion}</p>}
          </div>
        </div>
        <svg className="w-4 h-4 text-slate-300 group-hover:text-limablue-500 group-hover:translate-x-0.5 transition-all shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
      <div className="flex-1 min-h-0">{children}</div>
      {footer && <div className="mt-3 pt-3 border-t border-slate-50 text-xs text-slate-400">{footer}</div>}
    </div>
  );
}

// ─── Estados por tarjeta (skeleton / vacío / error — no tumban el tablero) ───
export function CardSkeleton({ height = 120 }: { height?: number }) {
  return <div className="animate-pulse rounded-xl bg-slate-100" style={{ height }} />;
}
export function CardVacio({ mensaje = 'Sin datos en este rango' }: { mensaje?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-6 text-slate-300">
      <svg className="w-7 h-7 mb-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13h2l1 7h12l1-7h2M5 13l1.5-9h11L19 13" /></svg>
      <p className="text-xs font-medium">{mensaje}</p>
    </div>
  );
}
export function CardError() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-6 text-red-300">
      <svg className="w-7 h-7 mb-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.5 0L3.18 16.25A2 2 0 005 19z" /></svg>
      <p className="text-xs font-medium">No se pudo cargar</p>
    </div>
  );
}

// ─── SectionHeader (en sub-páginas de detalle) ──────────────────────────────
export function SectionHeader({ title, subtitle, onExport }: { title: string; subtitle?: string; onExport?: () => void }) {
  return (
    <div className="flex items-center justify-between mb-4 gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-bold text-slate-700 truncate">{title}</h2>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {onExport && (
        <button
          onClick={onExport}
          className="px-3 py-1.5 text-xs font-semibold text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 shrink-0"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
          Excel
        </button>
      )}
    </div>
  );
}

export const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// ─── Heatmap (compacto para tarjeta / completo para detalle) ────────────────
export function Heatmap({ cells, compact = false }: { cells: { dia: number; hora: number; total: number }[]; compact?: boolean }) {
  const max = Math.max(...cells.map(c => c.total), 1);
  const byKey = new Map(cells.map(c => [`${c.dia}:${c.hora}`, c]));
  const horas = Array.from({ length: 12 }, (_, i) => i + 8);
  const cellH = compact ? 'h-4' : 'h-7';
  const cellW = compact ? 'w-7' : 'w-12';

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="w-8 pb-1" />
            {DIAS.map(d => <th key={d} className={cn('text-center text-slate-500 font-semibold pb-1', cellW)}>{compact ? d[0] : d}</th>)}
          </tr>
        </thead>
        <tbody>
          {horas.map(h => (
            <tr key={h}>
              <td className="text-right pr-1.5 text-slate-400 font-mono text-[10px]">{String(h).padStart(2, '0')}{compact ? '' : 'h'}</td>
              {[0, 1, 2, 3, 4, 5, 6].map(d => {
                const v = byKey.get(`${d}:${h}`)?.total ?? 0;
                const intensity = v / max;
                return (
                  <td
                    key={d}
                    title={`${DIAS[d]} ${h}:00 — ${v} citas`}
                    className={cn('rounded text-center font-semibold cursor-default', cellW, cellH, compact ? 'text-[0px]' : '')}
                    style={{
                      backgroundColor: v === 0 ? '#f1f5f9' : `rgba(37, 99, 235, ${0.12 + intensity * 0.78})`,
                      color: intensity > 0.6 ? '#fff' : '#1e40af',
                    }}
                  >
                    {!compact && v > 0 ? v : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
