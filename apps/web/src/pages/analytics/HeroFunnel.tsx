import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../../api/analytics';
import { cn } from '../../utils/cn';
import type { AnalyticsParams } from './filtros';
import { deltaTexto, deltaColor, fmtInt } from './ui';

// HERO como tesis: el EMBUDO DE AGENDAMIENTO. La verdad más característica de la operación de
// la clínica no es "total de citas", es DÓNDE SE PIERDEN: de las agendadas, cuántas llegaron y
// se completaron, y cuánta capacidad se fuga en no-shows y cancelaciones. Sobre navy profundo
// (mismo lenguaje oscuro del login Limablue) para que sea la única nota audaz del tablero.

function LeyendaSegmento({ label, valor, total, color }: { label: string; valor: number; total: number; color: string }) {
  return (
    <span className="flex items-center gap-1.5 text-sm">
      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
      <span className="font-mono font-bold tabular-nums">{fmtInt(valor)}</span>
      <span className="text-slate-400">{label}</span>
      <span className="font-mono text-xs text-slate-500">{total > 0 ? Math.round((valor / total) * 100) : 0}%</span>
    </span>
  );
}

export function HeroFunnel({ params }: { params: AnalyticsParams }) {
  const { data: k, isLoading } = useQuery({ queryKey: ['analytics-kpis', params], queryFn: () => analyticsApi.kpis(params), staleTime: 60_000 });

  if (isLoading) return <div className="rounded-3xl bg-gradient-to-br from-[#0b1b38] to-[#13294f] h-[260px] animate-pulse" />;
  if (!k) return null;

  const total = Math.max(k.totalCitas, 1);
  const fuga = k.noShow + k.canceladas;
  const pendientes = Math.max(k.totalCitas - k.completadas - k.noShow - k.canceladas, 0);
  // El destino REAL de cada cita agendada (suma = total). No es un embudo monotónico:
  // `llegaron` es un estado transitorio, así que mostramos la COMPOSICIÓN, que sí es veraz.
  const segmentos = [
    { label: 'Completadas', valor: k.completadas, color: '#10b981' },
    { label: 'No-show', valor: k.noShow, color: '#f59e0b' },
    { label: 'Canceladas', valor: k.canceladas, color: '#f43f5e' },
    { label: 'Pendientes', valor: pendientes, color: '#475569' },
  ].filter(s => s.valor > 0);

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0b1b38] to-[#13294f] text-white shadow-xl shadow-slate-300/40">
      {/* Acento superior — hairline */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-limablue-400/60 to-transparent" />
      {/* Resplandor ambiental sobrio */}
      <div className="pointer-events-none absolute -right-24 -top-24 w-72 h-72 rounded-full bg-limablue-500/10 blur-3xl" />

      <div className="relative grid grid-cols-1 lg:grid-cols-[minmax(0,300px)_1fr] gap-8 p-6 lg:p-8">
        {/* Titular: el desenlace que importa */}
        <div className="flex flex-col justify-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-limablue-200/80">Destino de las citas</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-[3.5rem] leading-none font-black tracking-tight tabular-nums">{fmtInt(k.completadas)}</span>
            <span className="text-sm font-semibold text-slate-300">completadas</span>
          </div>
          <p className="mt-1 text-sm text-slate-400">de <span className="font-mono tabular-nums text-slate-300">{fmtInt(k.totalCitas)}</span> citas agendadas</p>
          <div className="mt-3 flex items-center gap-3 text-xs">
            {deltaTexto(k.variacionCompletadas) && (
              <span className={cn('font-semibold', deltaColor(k.variacionCompletadas))}>{deltaTexto(k.variacionCompletadas)} <span className="text-slate-500 font-normal">vs período anterior</span></span>
            )}
          </div>
        </div>

        {/* Composición veraz: en qué terminó cada una de las citas agendadas */}
        <div className="flex flex-col justify-center gap-4">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            <span>Agendadas</span>
            <span className="font-mono text-sm tabular-nums text-white normal-case tracking-normal">{fmtInt(k.totalCitas)}</span>
          </div>
          {/* Barra apilada al 100% — cada segmento es proporción del total */}
          <div className="flex h-8 w-full rounded-lg overflow-hidden ring-1 ring-white/10">
            {segmentos.map(s => (
              <div key={s.label} title={`${s.label}: ${fmtInt(s.valor)}`} className="h-full flex items-center justify-center transition-all duration-700 ease-out" style={{ width: `${(s.valor / total) * 100}%`, background: s.color }}>
                {(s.valor / total) > 0.08 && <span className="font-mono text-xs font-bold text-white/95 tabular-nums">{fmtInt(s.valor)}</span>}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {segmentos.map(s => <LeyendaSegmento key={s.label} label={s.label} valor={s.valor} total={total} color={s.color} />)}
          </div>
          {/* La señal que un coordinador vigila */}
          <p className="text-xs text-slate-400 border-t border-white/10 pt-3">
            <span className="font-mono font-bold text-amber-300 tabular-nums">{fmtInt(fuga)}</span> citas perdieron su cupo por no-show o cancelación
            {pendientes > 0 && <> · <span className="font-mono font-bold text-slate-300 tabular-nums">{fmtInt(pendientes)}</span> sin desenlace registrado</>}
          </p>
        </div>
      </div>

      {/* Tira de tasas — datos de apoyo, quietos */}
      <div className="relative grid grid-cols-2 md:grid-cols-4 border-t border-white/10 divide-x divide-white/10">
        {[
          { label: 'Tasa completadas', val: `${k.tasaCompletadas}%`, delta: k.variacionCompletadas },
          { label: 'Tasa no-show', val: `${k.tasaNoShow}%`, delta: k.variacionNoShow, inv: true },
          { label: 'Horas atendidas', val: `${fmtInt(k.horasAtendidas)} h` },
          { label: 'Citas propias', val: `${k.tasaPropios}%`, sub: 'elegida por paciente' },
        ].map(s => (
          <div key={s.label} className="px-5 py-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{s.label}</p>
            <p className="mt-0.5 text-xl font-black tabular-nums">{s.val}</p>
            {s.sub && <p className="text-[10px] text-slate-500">{s.sub}</p>}
            {deltaTexto(s.delta) && <p className={cn('text-[10px] font-semibold mt-0.5', deltaColor(s.delta, s.inv))}>{deltaTexto(s.delta)}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
