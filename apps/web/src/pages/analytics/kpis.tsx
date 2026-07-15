import { useState, useMemo, type ReactNode } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from 'recharts';
import { analyticsApi } from '../../api/analytics';
import { useCanales } from '../../hooks/useCanales';
import { formatPromoValor } from '../../api/promociones';
import { cn } from '../../utils/cn';
import type { AnalyticsParams } from './filtros';
import {
  CardSkeleton, CardVacio, CardError, SectionHeader, Heatmap,
  exportToExcel, fmtInt,
} from './ui';

// ─── Helpers de presentación ─────────────────────────────────────────────────
type Grupo = 'Operación' | 'Calidad de agenda' | 'Comercial' | 'Sedes';
export const GRUPOS: Grupo[] = ['Operación', 'Calidad de agenda', 'Comercial', 'Sedes'];

export interface KpiDef {
  key: string;
  titulo: string;
  descripcion: string;
  grupo: Grupo;
  span?: 1 | 2;
  icon: ReactNode;
  Preview: (p: { params: AnalyticsParams }) => ReactNode;
  Detalle: (p: { params: AnalyticsParams }) => ReactNode;
}

const STALE = 60_000;

// Envuelve un preview/detalle con sus estados (skeleton/error/vacío) sin tumbar el tablero.
function Estado({ q, vacio, alto = 120, children }: { q: UseQueryResult<unknown>; vacio: boolean; alto?: number; children: ReactNode }) {
  if (q.isLoading) return <CardSkeleton height={alto} />;
  if (q.isError) return <CardError />;
  if (vacio) return <CardVacio />;
  return <>{children}</>;
}

function MiniBarRow({ label, value, max, color = '#3b82f6', sufijo }: { label: string; value: number; max: number; color?: string; sufijo?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-600 truncate flex-1 min-w-0">{label}</span>
      <div className="w-20 bg-slate-100 rounded-full h-1.5 overflow-hidden shrink-0">
        <div className="h-full rounded-full" style={{ width: `${max > 0 ? (value / max) * 100 : 0}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-bold text-slate-700 tabular-nums w-10 text-right shrink-0">{sufijo ?? fmtInt(value)}</span>
    </div>
  );
}

function Avatar({ nombre, color }: { nombre: string; color: string }) {
  return <span className="w-6 h-6 rounded-full text-white text-[11px] font-bold flex items-center justify-center shrink-0" style={{ backgroundColor: color }}>{nombre[0]}</span>;
}

const TooltipStyle = { fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' } as const;

// ─── TENDENCIA ────────────────────────────────────────────────────────────────
function useTendencia(params: AnalyticsParams, granularidad: 'auto' | 'dia' | 'semana' | 'mes' = 'auto') {
  return useQuery({ queryKey: ['analytics-tendencia', params, granularidad], queryFn: () => analyticsApi.tendencia({ ...params, granularidad }), staleTime: STALE });
}
function TendenciaPreview({ params }: { params: AnalyticsParams }) {
  const q = useTendencia(params);
  const puntos = q.data?.puntos ?? [];
  return (
    <Estado q={q} vacio={puntos.length === 0} alto={130}>
      <ResponsiveContainer width="100%" height={130}>
        <LineChart data={puntos} margin={{ top: 4, right: 6, left: -28, bottom: 0 }}>
          <YAxis tick={{ fontSize: 9, fill: '#cbd5e1' }} width={28} />
          <XAxis dataKey="fecha" hide />
          <Tooltip contentStyle={TooltipStyle} labelFormatter={v => String(v).slice(5)} />
          <Line type="monotone" dataKey="totalCitas" name="Total" stroke="#3b82f6" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="completadas" name="Compl." stroke="#22c55e" strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </Estado>
  );
}
function TendenciaDetalle({ params }: { params: AnalyticsParams }) {
  const [g, setG] = useState<'auto' | 'dia' | 'semana' | 'mes'>('auto');
  const q = useTendencia(params, g);
  const t = q.data;
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="text-base font-bold text-slate-700">Tendencia de citas{t && <span className="ml-2 text-xs font-normal text-slate-400">vista por {t.granularidad === 'dia' ? 'día' : t.granularidad === 'semana' ? 'semana' : 'mes'}</span>}</h2>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold">
            {(['auto', 'dia', 'semana', 'mes'] as const).map(opt => (
              <button key={opt} onClick={() => setG(opt)} className={cn('px-3 py-1.5 transition-all', g === opt ? 'bg-limablue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50')}>
                {opt === 'auto' ? 'Auto' : opt === 'dia' ? 'Día' : opt === 'semana' ? 'Semana' : 'Mes'}
              </button>
            ))}
          </div>
          {t && t.puntos.length > 0 && (
            <button onClick={() => exportToExcel(`tendencia_${params.desde}_${params.hasta}.xlsx`, [{ name: 'Tendencia', data: t.puntos.map(p => ({ Fecha: p.fecha, 'Total citas': p.totalCitas, Completadas: p.completadas, 'No-shows': p.noShow, Canceladas: p.canceladas })) }])} className="px-3 py-1.5 text-xs font-semibold text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">Excel</button>
          )}
        </div>
      </div>
      <Estado q={q} vacio={!t || t.puntos.length === 0} alto={320}>
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={t?.puntos ?? []} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="fecha" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={v => t?.granularidad === 'mes' ? String(v).slice(0, 7) : String(v).slice(5)} />
            <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
            <Tooltip contentStyle={TooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="totalCitas" name="Total" stroke="#3b82f6" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="completadas" name="Completadas" stroke="#22c55e" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="noShow" name="No-show" stroke="#f87171" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </Estado>
    </div>
  );
}

// ─── SERVICIOS ──────────────────────────────────────────────────────────────
function useServicios(params: AnalyticsParams) {
  return useQuery({ queryKey: ['analytics-servicios', params], queryFn: () => analyticsApi.servicios(params), staleTime: STALE });
}
function ServiciosPreview({ params }: { params: AnalyticsParams }) {
  const q = useServicios(params);
  const top = (q.data ?? []).slice(0, 4);
  const max = Math.max(...top.map(s => s.totalCitas), 1);
  return (
    <Estado q={q} vacio={top.length === 0}>
      <div className="space-y-2">{top.map(s => <MiniBarRow key={s.servicioId} label={s.nombre} value={s.totalCitas} max={max} color={s.color || '#3b82f6'} />)}</div>
    </Estado>
  );
}
function ServiciosDetalle({ params }: { params: AnalyticsParams }) {
  const q = useServicios(params);
  const servicios = q.data ?? [];
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <SectionHeader title="Servicios más demandados" onExport={servicios.length ? () => exportToExcel(`servicios_${params.desde}_${params.hasta}.xlsx`, [{ name: 'Servicios', data: servicios.map(s => ({ Servicio: s.nombre, 'Unidad de negocio': s.unidadNegocio, 'Total citas': s.totalCitas, Completadas: s.completadas, 'No-shows': s.noShow, 'Tasa completadas %': s.tasaCompletadas })) }]) : undefined} />
      <Estado q={q} vacio={servicios.length === 0} alto={320}>
        <ResponsiveContainer width="100%" height={Math.min(servicios.length * 32 + 60, 460)}>
          <BarChart data={servicios.slice(0, 15)} layout="vertical" margin={{ top: 0, right: 40, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
            <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} />
            <YAxis type="category" dataKey="nombre" tick={{ fontSize: 9, fill: '#475569' }} width={150} />
            <Tooltip contentStyle={TooltipStyle} />
            <Bar dataKey="totalCitas" name="Total citas" radius={[0, 4, 4, 0]}>
              {servicios.slice(0, 15).map((s, i) => <Cell key={i} fill={s.color || '#3b82f6'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Estado>
    </div>
  );
}

// ─── HORARIOS (heatmap) ──────────────────────────────────────────────────────
function useHeatmap(params: AnalyticsParams) {
  return useQuery({ queryKey: ['analytics-heatmap', params], queryFn: () => analyticsApi.heatmap(params), staleTime: STALE });
}
function HorariosPreview({ params }: { params: AnalyticsParams }) {
  const q = useHeatmap(params);
  const cells = q.data ?? [];
  return <Estado q={q} vacio={cells.length === 0}><Heatmap cells={cells} compact /></Estado>;
}
function HorariosDetalle({ params }: { params: AnalyticsParams }) {
  const q = useHeatmap(params);
  const cells = q.data ?? [];
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <SectionHeader title="Mapa de calor — citas por día y hora" subtitle="Identifica las franjas de mayor demanda" />
      <Estado q={q} vacio={cells.length === 0} alto={340}><Heatmap cells={cells} /></Estado>
    </div>
  );
}

// ─── PROFESIONALES ────────────────────────────────────────────────────────────
function useProfesionales(params: AnalyticsParams) {
  return useQuery({ queryKey: ['analytics-profesionales', params], queryFn: () => analyticsApi.profesionales(params), staleTime: STALE });
}
function ProfesionalesPreview({ params }: { params: AnalyticsParams }) {
  const q = useProfesionales(params);
  const top = (q.data ?? []).slice(0, 4);
  return (
    <Estado q={q} vacio={top.length === 0}>
      <div className="space-y-2">
        {top.map((p, i) => (
          <div key={p.profesionalId} className="flex items-center gap-2">
            <span className="text-xs text-slate-300 w-3 tabular-nums">{i + 1}</span>
            <Avatar nombre={p.nombres} color={p.colorAvatar} />
            <span className="text-xs font-medium text-slate-700 truncate flex-1">{p.nombres} {p.apellidos}</span>
            <span className="text-xs font-bold text-emerald-600 tabular-nums">{p.completadas}</span>
            <span className={cn('text-xs font-semibold tabular-nums w-10 text-right', p.tasaCompletadas >= 70 ? 'text-emerald-600' : 'text-amber-600')}>{p.tasaCompletadas}%</span>
          </div>
        ))}
      </div>
    </Estado>
  );
}
function ProfesionalesDetalle({ params }: { params: AnalyticsParams }) {
  const q = useProfesionales(params);
  const profesionales = q.data ?? [];
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <SectionHeader title="Ranking de profesionales" onExport={profesionales.length ? () => exportToExcel(`profesionales_${params.desde}_${params.hasta}.xlsx`, [{ name: 'Profesionales', data: profesionales.map(p => ({ Nombres: p.nombres, Apellidos: p.apellidos, 'Total citas': p.totalCitas, Completadas: p.completadas, 'No-shows': p.noShow, 'Tasa completadas %': p.tasaCompletadas, 'Tasa no-show %': p.tasaNoShow, 'Citas propias %': p.tasaPropios })) }]) : undefined} />
      <Estado q={q} vacio={profesionales.length === 0} alto={320}>
        <>
          <ResponsiveContainer width="100%" height={Math.min(profesionales.length * 36 + 60, 420)}>
            <BarChart data={profesionales.slice(0, 15)} layout="vertical" margin={{ top: 0, right: 40, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <YAxis type="category" dataKey="nombres" tick={{ fontSize: 10, fill: '#475569' }} width={90} />
              <Tooltip contentStyle={TooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="completadas" name="Completadas" fill="#22c55e" radius={[0, 4, 4, 0]} />
              <Bar dataKey="noShow" name="No-show" fill="#f87171" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-slate-100 text-slate-500">
                <th className="text-left py-2 pr-4 font-semibold">#</th><th className="text-left py-2 pr-4 font-semibold">Profesional</th>
                <th className="text-right py-2 pr-4 font-semibold">Total</th><th className="text-right py-2 pr-4 font-semibold">Compl.</th>
                <th className="text-right py-2 pr-4 font-semibold">No-show</th><th className="text-right py-2 pr-4 font-semibold">% Compl.</th><th className="text-right py-2 font-semibold">% Propias</th>
              </tr></thead>
              <tbody>
                {profesionales.map((p, i) => (
                  <tr key={p.profesionalId} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2 pr-4 text-slate-400">{i + 1}</td>
                    <td className="py-2 pr-4"><div className="flex items-center gap-2"><Avatar nombre={p.nombres} color={p.colorAvatar} /><span className="font-medium text-slate-700">{p.nombres} {p.apellidos}</span></div></td>
                    <td className="py-2 pr-4 text-right font-semibold text-slate-700">{p.totalCitas}</td>
                    <td className="py-2 pr-4 text-right text-emerald-600 font-semibold">{p.completadas}</td>
                    <td className="py-2 pr-4 text-right text-red-400 font-semibold">{p.noShow}</td>
                    <td className="py-2 pr-4 text-right"><span className={cn('font-semibold', p.tasaCompletadas >= 70 ? 'text-emerald-600' : 'text-amber-600')}>{p.tasaCompletadas}%</span></td>
                    <td className="py-2 text-right text-slate-600 font-semibold">{p.tasaPropios}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      </Estado>
    </div>
  );
}

// ─── NO-SHOW ──────────────────────────────────────────────────────────────────
function useNoshow(params: AnalyticsParams) {
  return useQuery({ queryKey: ['analytics-noshow', params], queryFn: () => analyticsApi.noshow(params), staleTime: STALE });
}
function NoshowPreview({ params }: { params: AnalyticsParams }) {
  const q = useNoshow(params);
  const top = (q.data?.porProfesional ?? []).slice(0, 4);
  return (
    <Estado q={q} vacio={top.length === 0}>
      <div className="space-y-2">
        {top.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-slate-300 w-3">{i + 1}</span>
            <span className="text-xs font-medium text-slate-700 flex-1 truncate">{p.nombres} {p.apellidos}</span>
            <span className="text-xs font-bold text-red-500 tabular-nums">{p.tasaNoShow}%</span>
            <span className="text-xs text-slate-400 tabular-nums w-12 text-right">{p.noShow}/{p.total}</span>
          </div>
        ))}
      </div>
    </Estado>
  );
}
function NoshowDetalle({ params }: { params: AnalyticsParams }) {
  const q = useNoshow(params);
  const n = q.data;
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <SectionHeader title="No-show por profesional" onExport={n && n.porProfesional.length ? () => exportToExcel(`noshow_prof_${params.desde}_${params.hasta}.xlsx`, [{ name: 'NoShow', data: n.porProfesional.map(p => ({ Nombres: p.nombres, Apellidos: p.apellidos, Total: p.total, 'No-shows': p.noShow, Canceladas: p.canceladas, 'Tasa no-show %': p.tasaNoShow })) }]) : undefined} />
        <Estado q={q} vacio={!n || n.porProfesional.length === 0} alto={240}>
          <div className="space-y-2">
            {(n?.porProfesional ?? []).map((p, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs text-slate-400 w-4">{i + 1}</span>
                <span className="text-xs font-medium text-slate-700 flex-1 truncate">{p.nombres} {p.apellidos}</span>
                <span className="text-xs font-semibold text-red-500 w-14 text-right">{p.tasaNoShow}%</span>
                <span className="text-xs text-slate-400 w-20 text-right">{p.noShow}/{p.total}</span>
              </div>
            ))}
          </div>
        </Estado>
      </div>
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <SectionHeader title="No-show por sede" />
        <Estado q={q} vacio={!n || n.porSede.length === 0} alto={160}>
          <div className="space-y-3">
            {(n?.porSede ?? []).map(s => (
              <div key={s.sedeId} className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-xs font-medium text-slate-700 flex-1">{s.nombre}</span>
                <div className="flex-1 max-w-32 bg-slate-100 rounded-full h-2 overflow-hidden"><div className="h-full rounded-full bg-red-400" style={{ width: `${s.tasaNoShow}%` }} /></div>
                <span className="text-xs font-bold text-red-500 w-12 text-right">{s.tasaNoShow}%</span>
                <span className="text-xs text-slate-400 w-20 text-right">{s.noShow}/{s.total}</span>
              </div>
            ))}
          </div>
        </Estado>
      </div>
    </div>
  );
}

// ─── CASELOAD ─────────────────────────────────────────────────────────────────
function useCaseload(params: AnalyticsParams) {
  return useQuery({ queryKey: ['analytics-caseload', params], queryFn: () => analyticsApi.caseload(params), staleTime: STALE });
}
function caseColor(p: number) { return p >= 60 ? '#22c55e' : p >= 30 ? '#f59e0b' : '#f87171'; }
function CaseloadPreview({ params }: { params: AnalyticsParams }) {
  const q = useCaseload(params);
  const top = (q.data ?? []).slice(0, 4);
  return (
    <Estado q={q} vacio={top.length === 0}>
      <div className="space-y-2.5">
        {top.map(r => (
          <div key={r.profesionalId} className="flex items-center gap-2">
            <Avatar nombre={r.nombres} color={r.colorAvatar} />
            <span className="text-xs font-medium text-slate-700 truncate flex-1">{r.nombres}</span>
            <div className="w-16 bg-slate-100 rounded-full h-1.5 overflow-hidden shrink-0"><div className="h-full rounded-full" style={{ width: `${r.pctPropios}%`, backgroundColor: caseColor(r.pctPropios) }} /></div>
            <span className="text-xs font-bold tabular-nums w-9 text-right" style={{ color: caseColor(r.pctPropios) }}>{r.pctPropios}%</span>
          </div>
        ))}
      </div>
    </Estado>
  );
}
function CaseloadDetalle({ params }: { params: AnalyticsParams }) {
  const q = useCaseload(params);
  const caseload = q.data ?? [];
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <SectionHeader title="Caseload propio — % elegida por paciente" onExport={caseload.length ? () => exportToExcel(`caseload_${params.desde}_${params.hasta}.xlsx`, [{ name: 'Caseload', data: caseload.map(r => ({ Nombres: r.nombres, Apellidos: r.apellidos, 'Total citas': r.totalCitas, Propias: r.propios, Asignadas: r.asignados, '% Propias': r.pctPropios })) }]) : undefined} />
      <Estado q={q} vacio={caseload.length === 0} alto={300}>
        <div className="space-y-2">
          {caseload.map(r => (
            <div key={r.profesionalId} className="flex items-center gap-3">
              <Avatar nombre={r.nombres} color={r.colorAvatar} />
              <span className="text-xs font-medium text-slate-700 w-40 truncate">{r.nombres} {r.apellidos}</span>
              <div className="flex-1 bg-slate-100 rounded-full h-2.5 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${r.pctPropios}%`, backgroundColor: caseColor(r.pctPropios) }} /></div>
              <span className="text-xs font-bold w-12 text-right" style={{ color: caseColor(r.pctPropios) }}>{r.pctPropios}%</span>
              <span className="text-xs text-slate-400 w-20 text-right">{r.propios}/{r.totalCitas}</span>
            </div>
          ))}
        </div>
      </Estado>
    </div>
  );
}

// ─── PACIENTES NUEVOS (captación) ─────────────────────────────────────────────
function usePacientesNuevos(params: AnalyticsParams) {
  return useQuery({ queryKey: ['analytics-pacientes-nuevos', params], queryFn: () => analyticsApi.pacientesNuevos(params), staleTime: STALE });
}
function VariacionBadge({ v }: { v: number | null }) {
  if (v === null) return <span className="text-[10px] text-slate-300">—</span>;
  const up = v >= 0;
  return <span className={cn('text-xs font-bold tabular-nums', up ? 'text-emerald-600' : 'text-red-500')}>{up ? '▲' : '▼'} {Math.abs(v)}%</span>;
}
function PacientesNuevosPreview({ params }: { params: AnalyticsParams }) {
  const q = usePacientesNuevos(params);
  const d = q.data;
  const puntos = d?.puntos ?? [];
  return (
    <Estado q={q} vacio={!d} alto={130}>
      <div className="flex items-end justify-between gap-3 mb-1.5">
        <div>
          <p className="text-3xl font-black text-slate-800 tabular-nums leading-none">{fmtInt(d?.total ?? 0)}</p>
          <p className="text-[11px] text-slate-400 font-semibold mt-1">nuevos en el período</p>
        </div>
        <div className="text-right">
          <VariacionBadge v={d?.variacion ?? null} />
          <p className="text-[10px] text-slate-400 mt-0.5">vs. período previo</p>
        </div>
      </div>
      {puntos.length > 1 && (
        <ResponsiveContainer width="100%" height={62}>
          <BarChart data={puntos} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="mes" hide />
            <Tooltip contentStyle={TooltipStyle} />
            <Bar dataKey="nuevos" name="Nuevos" fill="#0e9c88" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Estado>
  );
}
function PacientesNuevosDetalle({ params }: { params: AnalyticsParams }) {
  const q = usePacientesNuevos(params);
  const d = q.data;
  const puntos = d?.puntos ?? [];
  const sedes = d?.porSede ?? [];
  const maxSede = Math.max(...sedes.map(s => s.nuevos), 1);
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <SectionHeader
          title="Pacientes nuevos por mes"
          subtitle="Un paciente cuenta como nuevo el mes de su PRIMERA visita (historial + citas)"
          onExport={puntos.length ? () => exportToExcel(`pacientes_nuevos_${params.desde}_${params.hasta}.xlsx`, [{ name: 'Pacientes nuevos', data: puntos.map(p => ({ Mes: p.mes, Nuevos: p.nuevos })) }]) : undefined}
        />
        <div className="flex items-baseline gap-3 mb-4">
          <span className="text-4xl font-black text-slate-800 tabular-nums">{fmtInt(d?.total ?? 0)}</span>
          <span className="text-sm text-slate-400 font-semibold">nuevos en el período</span>
          <VariacionBadge v={d?.variacion ?? null} />
        </div>
        <Estado q={q} vacio={puntos.length === 0} alto={300}>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={puntos} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="mes" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} allowDecimals={false} />
              <Tooltip contentStyle={TooltipStyle} />
              <Bar dataKey="nuevos" name="Nuevos" fill="#0e9c88" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Estado>
      </div>
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <SectionHeader title="Captación por sede" subtitle="Sede de la primera visita del paciente" />
        <Estado q={q} vacio={sedes.length === 0} alto={160}>
          <div className="space-y-2.5">
            {sedes.map(s => (
              <div key={s.sede} className="flex items-center gap-3">
                <span className="text-xs font-medium text-slate-700 flex-1 truncate">{s.sede}</span>
                <div className="flex-1 max-w-sm bg-slate-100 rounded-full h-2.5 overflow-hidden"><div className="h-full rounded-full bg-teal-500" style={{ width: `${(s.nuevos / maxSede) * 100}%` }} /></div>
                <span className="text-xs font-bold text-slate-700 tabular-nums w-16 text-right">{fmtInt(s.nuevos)}</span>
              </div>
            ))}
          </div>
        </Estado>
      </div>
    </div>
  );
}

// ─── CANALES ──────────────────────────────────────────────────────────────────
function useCanalesData(params: AnalyticsParams) {
  const q = useQuery({ queryKey: ['analytics-canales', params], queryFn: () => analyticsApi.canales(params), staleTime: STALE });
  const { labelCanal } = useCanales();
  const data = useMemo(() => (q.data ?? []).map(c => ({ label: labelCanal(c.canal), totalCitas: c.totalCitas, completadas: c.completadas, porcentaje: c.porcentaje })).sort((a, b) => b.totalCitas - a.totalCitas), [q.data, labelCanal]);
  return { q, data };
}
function CanalesPreview({ params }: { params: AnalyticsParams }) {
  const { q, data } = useCanalesData(params);
  const top = data.slice(0, 5);
  const max = Math.max(...top.map(c => c.totalCitas), 1);
  return <Estado q={q} vacio={top.length === 0}><div className="space-y-2">{top.map(c => <MiniBarRow key={c.label} label={c.label} value={c.totalCitas} max={max} color="#6366f1" />)}</div></Estado>;
}
function CanalesDetalle({ params }: { params: AnalyticsParams }) {
  const { q, data } = useCanalesData(params);
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <SectionHeader title="Canal de reserva — de dónde viene el cliente" onExport={data.length ? () => exportToExcel(`canales_${params.desde}_${params.hasta}.xlsx`, [{ name: 'Canales', data: data.map(c => ({ Canal: c.label, 'Total citas': c.totalCitas, Completadas: c.completadas, '% del total': c.porcentaje })) }]) : undefined} />
      <Estado q={q} vacio={data.length === 0} alto={320}>
        <ResponsiveContainer width="100%" height={Math.min(data.length * 34 + 60, 440)}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 48, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
            <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} />
            <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: '#475569' }} width={140} />
            <Tooltip contentStyle={TooltipStyle} />
            <Bar dataKey="totalCitas" name="Total citas" radius={[0, 4, 4, 0]} fill="#6366f1" />
          </BarChart>
        </ResponsiveContainer>
      </Estado>
    </div>
  );
}

// ─── PROMOCIONES ──────────────────────────────────────────────────────────────
function usePromocionesData(params: AnalyticsParams) {
  const q = useQuery({ queryKey: ['analytics-promociones', params], queryFn: () => analyticsApi.promociones(params), staleTime: STALE });
  const data = useMemo(() => (q.data ?? []).map(p => ({ label: p.nombre, valor: formatPromoValor(p.tipo, p.valor), totalCitas: p.totalCitas, completadas: p.completadas, porcentaje: p.porcentajeCompletadas })), [q.data]);
  return { q, data };
}
function PromocionesPreview({ params }: { params: AnalyticsParams }) {
  const { q, data } = usePromocionesData(params);
  const top = data.slice(0, 4);
  const max = Math.max(...top.map(p => p.totalCitas), 1);
  return (
    <Estado q={q} vacio={top.length === 0}>
      <div className="space-y-2">{top.map(p => <MiniBarRow key={p.label} label={p.label} value={p.totalCitas} max={max} color="#ec4899" sufijo={`${p.totalCitas}`} />)}</div>
    </Estado>
  );
}
function PromocionesDetalle({ params }: { params: AnalyticsParams }) {
  const { q, data } = usePromocionesData(params);
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <SectionHeader title="Promociones — uso según la agenda" onExport={data.length ? () => exportToExcel(`promociones_${params.desde}_${params.hasta}.xlsx`, [{ name: 'Promociones', data: data.map(p => ({ Promoción: p.label, 'Precio/Descuento': p.valor, 'Total citas': p.totalCitas, Completadas: p.completadas, '% completadas': p.porcentaje })) }]) : undefined} />
      <Estado q={q} vacio={data.length === 0} alto={320}>
        <>
          <ResponsiveContainer width="100%" height={Math.min(data.length * 34 + 60, 520)}>
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 48, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: '#475569' }} width={180} />
              <Tooltip contentStyle={TooltipStyle} />
              <Bar dataKey="totalCitas" name="Usos" radius={[0, 4, 4, 0]} fill="#ec4899" />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-slate-400 border-b border-slate-100">
                <th className="text-left font-semibold py-1.5 pr-3">Promoción</th><th className="text-left font-semibold py-1.5 pr-3">Precio/Dscto</th>
                <th className="text-right font-semibold py-1.5 pr-3">Usos</th><th className="text-right font-semibold py-1.5 pr-3">Completadas</th><th className="text-right font-semibold py-1.5">% compl.</th>
              </tr></thead>
              <tbody>
                {data.map((p, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="py-1.5 pr-3 text-slate-700">{p.label}</td><td className="py-1.5 pr-3 text-pink-600 font-medium">{p.valor}</td>
                    <td className="py-1.5 pr-3 text-right text-slate-700">{p.totalCitas}</td><td className="py-1.5 pr-3 text-right text-slate-700">{p.completadas}</td><td className="py-1.5 text-right text-slate-700">{p.porcentaje}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      </Estado>
    </div>
  );
}

// ─── SEDES ────────────────────────────────────────────────────────────────────
function useSedesData(params: AnalyticsParams) {
  return useQuery({ queryKey: ['analytics-sedes', params], queryFn: () => analyticsApi.sedes(params), staleTime: STALE });
}
function SedesPreview({ params }: { params: AnalyticsParams }) {
  const q = useSedesData(params);
  const sedes = q.data ?? [];
  const max = Math.max(...sedes.map(s => s.totalCitas), 1);
  return <Estado q={q} vacio={sedes.length === 0}><div className="space-y-2">{sedes.map(s => <MiniBarRow key={s.sedeId} label={s.nombre} value={s.totalCitas} max={max} color={s.color || '#3b82f6'} />)}</div></Estado>;
}
function SedesDetalle({ params }: { params: AnalyticsParams }) {
  const q = useSedesData(params);
  const sedes = q.data ?? [];
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <SectionHeader title="Comparativa de sedes" onExport={sedes.length ? () => exportToExcel(`sedes_${params.desde}_${params.hasta}.xlsx`, [{ name: 'Sedes', data: sedes.map(s => ({ Sede: s.nombre, 'Total citas': s.totalCitas, Completadas: s.completadas, 'No-shows': s.noShow, Canceladas: s.canceladas, 'Tasa completadas %': s.tasaCompletadas, 'Tasa no-show %': s.tasaNoShow, '% Propias': s.tasaPropios })) }]) : undefined} />
      <Estado q={q} vacio={sedes.length === 0} alto={300}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={sedes} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="nombre" tick={{ fontSize: 10, fill: '#475569' }} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <Tooltip contentStyle={TooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="completadas" name="Completadas" radius={[4, 4, 0, 0]}>{sedes.map((s, i) => <Cell key={i} fill={s.color || '#3b82f6'} />)}</Bar>
              <Bar dataKey="noShow" name="No-show" fill="#f87171" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-slate-100 text-slate-500"><th className="text-left py-2 pr-3 font-semibold">Sede</th><th className="text-right py-2 pr-3 font-semibold">Total</th><th className="text-right py-2 pr-3 font-semibold">% Comp.</th><th className="text-right py-2 font-semibold">% NS</th></tr></thead>
              <tbody>
                {sedes.map(s => (
                  <tr key={s.sedeId} className="border-b border-slate-50">
                    <td className="py-2 pr-3"><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} /><span className="font-medium text-slate-700">{s.nombre}</span></div></td>
                    <td className="py-2 pr-3 text-right font-semibold">{s.totalCitas}</td>
                    <td className="py-2 pr-3 text-right"><span className={cn('font-semibold', s.tasaCompletadas >= 70 ? 'text-emerald-600' : 'text-amber-600')}>{s.tasaCompletadas}%</span></td>
                    <td className="py-2 text-right"><span className={cn('font-semibold', s.tasaNoShow <= 10 ? 'text-emerald-600' : 'text-red-500')}>{s.tasaNoShow}%</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Estado>
    </div>
  );
}

// ─── Iconos (inline, sobrios) ────────────────────────────────────────────────
const I = (d: string) => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={d} /></svg>;
const icons = {
  tendencia: I('M3 17l6-6 4 4 8-8M21 7h-4m4 0v4'),
  servicios: I('M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10'),
  horarios: I('M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'),
  profesionales: I('M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'),
  noshow: I('M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636'),
  caseload: I('M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z'),
  canales: I('M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z'),
  promociones: I('M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z'),
  sedes: I('M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4'),
  pacientesNuevos: I('M18 9v6m3-3h-6M12 7a4 4 0 11-8 0 4 4 0 018 0zM2 21v-2a5 5 0 015-5h2a5 5 0 015 5v2'),
};

// ─── Registro de KPIs ────────────────────────────────────────────────────────
export const KPIS: KpiDef[] = [
  { key: 'tendencia', titulo: 'Tendencia de citas', descripcion: 'Evolución en el período', grupo: 'Operación', span: 2, icon: icons.tendencia, Preview: TendenciaPreview, Detalle: TendenciaDetalle },
  { key: 'servicios', titulo: 'Servicios más demandados', descripcion: 'Top por volumen', grupo: 'Operación', icon: icons.servicios, Preview: ServiciosPreview, Detalle: ServiciosDetalle },
  { key: 'horarios', titulo: 'Mapa de horarios', descripcion: 'Demanda por día y hora', grupo: 'Operación', icon: icons.horarios, Preview: HorariosPreview, Detalle: HorariosDetalle },
  { key: 'profesionales', titulo: 'Ranking de profesionales', descripcion: 'Top por completadas', grupo: 'Calidad de agenda', icon: icons.profesionales, Preview: ProfesionalesPreview, Detalle: ProfesionalesDetalle },
  { key: 'noshow', titulo: 'No-show', descripcion: 'Inasistencias por profesional', grupo: 'Calidad de agenda', icon: icons.noshow, Preview: NoshowPreview, Detalle: NoshowDetalle },
  { key: 'caseload', titulo: 'Caseload propio', descripcion: '% elegida por paciente', grupo: 'Calidad de agenda', icon: icons.caseload, Preview: CaseloadPreview, Detalle: CaseloadDetalle },
  { key: 'pacientes-nuevos', titulo: 'Pacientes nuevos', descripcion: 'Captación por mes (primera visita)', grupo: 'Comercial', span: 2, icon: icons.pacientesNuevos, Preview: PacientesNuevosPreview, Detalle: PacientesNuevosDetalle },
  { key: 'canales', titulo: 'Canales de reserva', descripcion: 'De dónde viene el cliente', grupo: 'Comercial', icon: icons.canales, Preview: CanalesPreview, Detalle: CanalesDetalle },
  { key: 'promociones', titulo: 'Promociones', descripcion: 'Uso según la agenda', grupo: 'Comercial', icon: icons.promociones, Preview: PromocionesPreview, Detalle: PromocionesDetalle },
  { key: 'sedes', titulo: 'Comparativa de sedes', descripcion: 'Volumen y calidad por sede', grupo: 'Sedes', span: 2, icon: icons.sedes, Preview: SedesPreview, Detalle: SedesDetalle },
];

export const KPI_MAP = new Map(KPIS.map(k => [k.key, k]));
