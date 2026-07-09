// Reportes RRHH (admin + coordinadora). Dos reportes derivados de la agenda:
//  1) Horas extra fuera del horario regular (con equivalente de recargo peruano 25/35/100%).
//  2) Rotación intersedes por mes (sede base vs préstamos) + meta de días para bonos.
// Solo lectura + fijar la meta por podóloga. Exportable a CSV para nómina.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, endOfMonth, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { sedesApi } from '../../api';
import { reportesApi, type FilaHoraExtra, type FilaRotacion } from '../../api/reportes';
import { cn } from '../../utils/cn';

type Tab = 'horas' | 'rotacion';

function mesActual() { return format(new Date(), 'yyyy-MM'); }
function rangoDeMes(mes: string) {
  const desde = `${mes}-01`;
  const hasta = format(endOfMonth(parseISO(desde)), 'yyyy-MM-dd');
  return { desde, hasta };
}
const fmtDia = (f: string) => format(parseISO(f), "d 'de' MMM", { locale: es });

// Descarga un CSV (BOM para que Excel respete acentos).
function descargarCSV(nombre: string, filas: (string | number)[][]) {
  const esc = (v: string | number) => { const s = String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + filas.map((f) => f.map(esc).join(';')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre; a.click();
  URL.revokeObjectURL(url);
}

export function ReportesRrhhPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('horas');
  const [mes, setMes] = useState(mesActual());
  const [sedeId, setSedeId] = useState('');
  const { desde, hasta } = rangoDeMes(mes);

  const { data: sedes = [] } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });
  const nombreMes = format(parseISO(desde), 'MMMM yyyy', { locale: es });

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/herramientas')} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100" title="Volver">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-700 flex items-center justify-center shrink-0"><span className="text-white text-lg">📊</span></div>
        <div>
          <h1 className="text-base font-bold text-slate-900">Reportes RRHH</h1>
          <p className="text-xs text-slate-500">Horas extra fuera de horario y rotación intersedes para el pago de bonos</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-slate-200 px-6 flex gap-0">
        {([['horas', 'Horas extra'], ['rotacion', 'Rotación intersedes']] as [Tab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn('px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap',
              tab === id ? 'border-indigo-500 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700')}>
            {label}
          </button>
        ))}
      </div>

      {/* Filtros comunes */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex flex-wrap items-end gap-4">
        <label className="text-xs font-semibold text-slate-500">Mes
          <input type="month" className="input text-sm mt-1 block" value={mes} onChange={(e) => setMes(e.target.value)} />
        </label>
        <label className="text-xs font-semibold text-slate-500">Sede {tab === 'rotacion' && <span className="font-normal text-slate-400">(sede base)</span>}
          <select className="input text-sm mt-1 block min-w-[160px]" value={sedeId} onChange={(e) => setSedeId(e.target.value)}>
            <option value="">Todas</option>
            {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </label>
        <span className="text-xs text-slate-400 pb-2 capitalize">{nombreMes}</span>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {tab === 'horas'
          ? <TabHorasExtra desde={desde} hasta={hasta} sedeId={sedeId || undefined} nombreMes={nombreMes} />
          : <TabRotacion desde={desde} hasta={hasta} sedeId={sedeId || undefined} nombreMes={nombreMes} />}
      </div>
    </div>
  );
}

// ─── TAB 1: HORAS EXTRA ───────────────────────────────────────────────────────
function TabHorasExtra({ desde, hasta, sedeId, nombreMes }: { desde: string; hasta: string; sedeId?: string; nombreMes: string }) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['reporte-horas-extra', desde, hasta, sedeId],
    queryFn: () => reportesApi.horasExtra({ desde, hasta, sedeId }),
  });

  const exportar = () => {
    if (!data) return;
    const filas: (string | number)[][] = [['Podóloga', 'Fecha', 'Sede', 'Entrada', 'Salida', 'Tipo', 'Horas extra', 'Horas equivalentes (con recargo)', 'Nota']];
    for (const p of data.profesionales)
      for (const d of p.dias)
        filas.push([p.nombre, d.fecha, d.sede, d.entrada, d.salida, d.categoria === 'DESCANSO' ? 'Descanso/Feriado (+100%)' : 'Extensión (+25/35%)', d.horas, d.equivalente, d.nota ?? '']);
    descargarCSV(`horas-extra-${desde}_a_${hasta}.csv`, filas);
  };

  if (isLoading) return <p className="text-sm text-slate-400 text-center py-12">Calculando…</p>;
  if (!data || data.profesionales.length === 0)
    return <VacioReporte texto={`Sin horas extra registradas en ${nombreMes}. Aparecen cuando la coordinadora abre un día especial o extiende el horario y asigna podólogas.`} />;

  return (
    <div className="space-y-4">
      {/* Resumen + export */}
      <div className="flex flex-wrap items-center gap-3">
        <Tarjeta valor={`${data.totalHorasExtra} h`} etiqueta="Horas extra totales" color="bg-indigo-50 text-indigo-700" />
        <Tarjeta valor={`${data.totalHorasEquivalentes} h`} etiqueta="Equivalente con recargo (pagable)" color="bg-violet-50 text-violet-700" />
        <Tarjeta valor={data.profesionales.length} etiqueta="Personas con horas extra" color="bg-slate-100 text-slate-700" />
        <button onClick={exportar} className="btn btn-secondary btn-sm ml-auto">⬇ Exportar CSV</button>
      </div>
      <p className="text-xxs text-slate-400">
        Recargo peruano (referencial): extensión de jornada <b>+25%</b> las 2 primeras horas del día y <b>+35%</b> desde la 3ª; descanso semanal/feriado <b>+100%</b> — aquí se muestra la <b>jornada + sobretasa (×2)</b>.
        <b className="text-rose-500"> Ojo:</b> en feriado/descanso sin descanso sustitutorio la planilla paga <b>TRIPLE</b> (el día ya incluido en el sueldo fijo <b>+</b> esta cifra). Con descanso sustitutorio no hay sobretasa. La planilla aplica el sueldo real.
      </p>

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-xs text-slate-500 border-b border-slate-100 bg-slate-50">
              <th className="px-4 py-2.5 text-left font-semibold">Podóloga</th>
              <th className="px-3 py-2.5 text-center font-semibold">Días extendidos</th>
              <th className="px-3 py-2.5 text-center font-semibold">Días descanso/feriado</th>
              <th className="px-3 py-2.5 text-right font-semibold">Horas extra</th>
              <th className="px-3 py-2.5 text-right font-semibold">Equivalente (recargo)</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {data.profesionales.map((p) => (
              <FilaHoras key={p.profesionalId} p={p} abierto={abierto === p.profesionalId} onToggle={() => setAbierto(abierto === p.profesionalId ? null : p.profesionalId)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilaHoras({ p, abierto, onToggle }: { p: FilaHoraExtra; abierto: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="border-b border-slate-50 hover:bg-slate-50/70 cursor-pointer" onClick={onToggle}>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xxs font-bold shrink-0" style={{ backgroundColor: p.colorAvatar }}>
              {p.nombre.split(' ').map((x) => x[0]).slice(0, 2).join('')}
            </span>
            <span className="font-medium text-slate-800">{p.nombre}</span>
          </div>
        </td>
        <td className="px-3 py-2.5 text-center text-slate-600">{p.diasExtendido || '—'}</td>
        <td className="px-3 py-2.5 text-center text-slate-600">{p.diasDescanso || '—'}</td>
        <td className="px-3 py-2.5 text-right font-semibold text-slate-800">{p.horasExtra} h</td>
        <td className="px-3 py-2.5 text-right font-bold text-violet-700">{p.horasEquivalentes} h</td>
        <td className="px-3 py-2.5 text-right text-slate-400 text-xs">{abierto ? '▲' : '▼'}</td>
      </tr>
      {abierto && (
        <tr className="bg-slate-50/60">
          <td colSpan={6} className="px-4 py-3">
            <div className="space-y-1">
              {p.dias.map((d, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.sedeColor }} />
                  <span className="w-28 text-slate-600 capitalize">{fmtDia(d.fecha)}</span>
                  <span className="w-24 text-slate-500">{d.sede}</span>
                  <span className="w-24 text-slate-500 font-mono">{d.entrada}–{d.salida}</span>
                  <span className={cn('px-1.5 py-0.5 rounded text-xxs font-semibold', d.categoria === 'DESCANSO' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700')}>
                    {d.categoria === 'DESCANSO' ? '+100%' : '+25/35%'}
                  </span>
                  <span className="text-slate-700 font-medium">{d.horas} h → <b className="text-violet-700">{d.equivalente} h</b></span>
                  {d.nota && <span className="text-slate-400 truncate">· {d.nota}</span>}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── TAB 2: ROTACIÓN INTERSEDES ───────────────────────────────────────────────
// Solo: podóloga, en qué sedes estuvo y cuántos días en cada una (+ detalle día a día).
function TabRotacion({ desde, hasta, sedeId, nombreMes }: { desde: string; hasta: string; sedeId?: string; nombreMes: string }) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['reporte-rotacion', desde, hasta, sedeId],
    queryFn: () => reportesApi.rotacion({ desde, hasta, sedeId }),
  });

  const exportar = () => {
    if (!data) return;
    const nombresSede = data.sedes.map((s) => s.nombre);
    const filas: (string | number)[][] = [['Podóloga', 'Sede base', ...nombresSede, 'Total días', 'Días préstamo']];
    for (const p of data.profesionales) {
      const porSede = new Map(p.porSede.map((s) => [s.sede, s.dias]));
      filas.push([p.nombre, p.sedeBase ?? '—', ...nombresSede.map((n) => porSede.get(n) ?? 0), p.totalDias, p.diasPrestamo]);
    }
    descargarCSV(`rotacion-intersedes-${desde}_a_${hasta}.csv`, filas);
  };

  if (isLoading) return <p className="text-sm text-slate-400 text-center py-12">Cargando…</p>;
  if (!data || data.profesionales.length === 0)
    return <VacioReporte texto={`Sin podólogas para ${nombreMes}${sedeId ? ' en esta sede base' : ''}.`} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xxs text-slate-400 max-w-lg pb-1">
          En qué sedes estuvo cada podóloga y cuántos días en cada una. El chip con anillo naranja marca días de préstamo a otra sede. Abre una fila para ver el detalle día a día.
        </p>
        <button onClick={exportar} className="btn btn-secondary btn-sm ml-auto">⬇ Exportar CSV</button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-xs text-slate-500 border-b border-slate-100 bg-slate-50">
              <th className="px-4 py-2.5 text-left font-semibold">Podóloga</th>
              <th className="px-3 py-2.5 text-left font-semibold">Sedes y días</th>
              <th className="px-3 py-2.5 text-center font-semibold">Total días</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {data.profesionales.map((p) => (
              <FilaRotacionRow
                key={p.profesionalId}
                p={p}
                abierto={abierto === p.profesionalId}
                onToggle={() => setAbierto(abierto === p.profesionalId ? null : p.profesionalId)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilaRotacionRow({ p, abierto, onToggle }: { p: FilaRotacion; abierto: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="border-b border-slate-50 hover:bg-slate-50/70 cursor-pointer" onClick={onToggle}>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xxs font-bold shrink-0" style={{ backgroundColor: p.colorAvatar }}>
              {p.nombre.split(' ').map((x) => x[0]).slice(0, 2).join('')}
            </span>
            <span className="font-medium text-slate-800">{p.nombre}</span>
          </div>
        </td>
        <td className="px-3 py-2.5">
          <div className="flex flex-wrap gap-1">
            {p.porSede.map((s) => (
              <span key={s.sede} className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xxs font-medium', s.prestamo ? 'ring-1 ring-amber-400 bg-amber-50 text-amber-800' : 'text-white')}
                style={s.prestamo ? {} : { backgroundColor: s.color }} title={s.prestamo ? 'Incluye días de préstamo' : undefined}>
                {s.prestamo && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.color }} />}
                {s.sede}: {s.dias}
              </span>
            ))}
            {p.porSede.length === 0 && <span className="text-xs text-slate-400">Sin días</span>}
          </div>
        </td>
        <td className="px-3 py-2.5 text-center font-semibold text-slate-800">{p.totalDias}</td>
        <td className="px-3 py-2.5 text-right text-slate-400 text-xs">{abierto ? '▲' : '▼'}</td>
      </tr>
      {abierto && (
        <tr className="bg-slate-50/60">
          <td colSpan={4} className="px-4 py-3">
            <p className="text-xxs text-slate-400 mb-1.5">Presencia día a día ({p.diasBase} en base · {p.diasPrestamo} en préstamo). El anillo naranja marca préstamo a otra sede.</p>
            <div className="flex flex-wrap gap-0.5">
              {p.timeline.map((t) => (
                <span
                  key={t.fecha}
                  title={`${fmtDia(t.fecha)}${t.sede ? ' · ' + t.sede : ' · sin trabajar'}${t.prestamo ? ' (préstamo)' : ''}`}
                  className={cn('w-5 h-5 rounded text-[8px] flex items-center justify-center', t.prestamo && 'ring-2 ring-amber-400', !t.trabaja && 'opacity-25')}
                  style={{ backgroundColor: t.trabaja && t.color ? t.color : '#e2e8f0', color: t.trabaja ? '#fff' : '#94a3b8' }}
                >
                  {t.fecha.slice(8)}
                </span>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Auxiliares ───────────────────────────────────────────────────────────────
function Tarjeta({ valor, etiqueta, color }: { valor: string | number; etiqueta: string; color: string }) {
  return (
    <div className={cn('rounded-xl px-4 py-2.5', color)}>
      <p className="text-lg font-bold leading-tight">{valor}</p>
      <p className="text-xxs font-medium opacity-80">{etiqueta}</p>
    </div>
  );
}
function VacioReporte({ texto }: { texto: string }) {
  return (
    <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center text-slate-400">
      <p className="text-3xl mb-2">📊</p>
      <p className="text-sm max-w-md mx-auto">{texto}</p>
    </div>
  );
}
