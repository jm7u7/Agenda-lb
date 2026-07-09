// Horarios del personal (admin + coordinadora). Define el horario semanal PERMANENTE
// de cada trabajador: qué días y en qué rango horario trabaja, vigente hasta editarlo.
// Distinto de Permisos/Bloqueos (excepciones puntuales) y de Días especiales.
// Usa el endpoint aditivo PUT /profesionales/:id/horario (reusa HorarioProfesional).

import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { profesionalesApi } from '../../api';
import { cn } from '../../utils/cn';

// Orden de días: Lun..Dom (diaSemana: 0=Dom..6=Sáb).
const DIAS = [
  { n: 1, label: 'Lunes' }, { n: 2, label: 'Martes' }, { n: 3, label: 'Miércoles' },
  { n: 4, label: 'Jueves' }, { n: 5, label: 'Viernes' }, { n: 6, label: 'Sábado' }, { n: 0, label: 'Domingo' },
];
const TIPO_LABEL: Record<string, string> = { podologa: 'Podólogas', medico: 'Médicos', fisioterapeuta: 'Fisioterapeutas' };

export function HorariosPersonalPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);

  const { data: personal = [], isLoading } = useQuery({
    queryKey: ['personal-todos'],
    queryFn: () => profesionalesApi.listar({ activo: true }),
  });

  // Las "máquinas" de baropodometría (Baro 1 / Baro 2) son pseudo-personas: NO tienen
  // horario de trabajo propio, así que se excluyen de este módulo (solo personal real).
  const esMaquinaBaro = (p: { nombres: string; apellidos: string }) =>
    /^baro(\s*\d+)?$/i.test(`${p.nombres} ${p.apellidos}`.trim());

  const grupos = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtrados = personal.filter((p) => !esMaquinaBaro(p) && (!term || `${p.nombres} ${p.apellidos}`.toLowerCase().includes(term)));
    const porTipo = new Map<string, typeof filtrados>();
    for (const p of filtrados) {
      const k = p.tipo ?? 'otro';
      const arr = porTipo.get(k) ?? [];
      arr.push(p);
      porTipo.set(k, arr);
    }
    return [...porTipo.entries()].sort((a, b) => (TIPO_LABEL[a[0]] ?? a[0]).localeCompare(TIPO_LABEL[b[0]] ?? b[0]));
  }, [personal, q]);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/herramientas')} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100" title="Volver">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-400 to-cyan-600 flex items-center justify-center shrink-0"><span className="text-white text-lg">🗓️</span></div>
        <div>
          <h1 className="text-base font-bold text-slate-900">Horarios del personal</h1>
          <p className="text-xs text-slate-500">Días y horas de trabajo permanentes de cada persona (hasta cambiarlo). Los bloqueos puntuales van en Permisos.</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        <input className="input text-sm w-full" placeholder="Buscar por nombre…" value={q} onChange={(e) => setQ(e.target.value)} />

        {isLoading ? (
          <p className="text-sm text-slate-400 text-center py-12">Cargando…</p>
        ) : grupos.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-12">Sin personal que coincida.</p>
        ) : grupos.map(([tipo, lista]) => (
          <div key={tipo} className="space-y-2">
            <p className="text-xxs font-semibold text-slate-400 uppercase tracking-widest">{TIPO_LABEL[tipo] ?? tipo} · {lista.length}</p>
            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
              {lista.map((p) => (
                <div key={p.id}>
                  <button
                    onClick={() => setAbierto(abierto === p.id ? null : p.id)}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-slate-50/70"
                  >
                    <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xxs font-bold shrink-0" style={{ backgroundColor: p.colorAvatar }}>
                      {`${p.nombres} ${p.apellidos}`.split(' ').map((x) => x[0]).slice(0, 2).join('')}
                    </span>
                    <span className="flex-1 text-sm font-medium text-slate-800">{p.nombres} {p.apellidos}</span>
                    <span className="text-slate-400 text-xs">{abierto === p.id ? '▲' : '▼'}</span>
                  </button>
                  {abierto === p.id && <EditorHorario profesionalId={p.id} nombre={`${p.nombres} ${p.apellidos}`} />}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface DiaEstado { activo: boolean; horaInicio: string; horaFin: string }

function EditorHorario({ profesionalId, nombre }: { profesionalId: string; nombre: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['horario-semanal', profesionalId],
    queryFn: () => profesionalesApi.horarioSemanal(profesionalId),
  });

  // Estado editable por día (0..6). Se inicializa una vez con lo que trae el servidor.
  const [estado, setEstado] = useState<Record<number, DiaEstado> | null>(null);
  const base = useMemo(() => {
    const m: Record<number, DiaEstado> = {};
    for (const d of DIAS) m[d.n] = { activo: false, horaInicio: '08:00', horaFin: '20:00' };
    for (const h of data?.horarios ?? []) m[h.diaSemana] = { activo: true, horaInicio: h.horaInicio, horaFin: h.horaFin };
    return m;
  }, [data]);
  const ed = estado ?? base;

  const guardar = useMutation({
    mutationFn: () => {
      const dias = DIAS.filter((d) => ed[d.n].activo).map((d) => ({ diaSemana: d.n, horaInicio: ed[d.n].horaInicio, horaFin: ed[d.n].horaFin }));
      return profesionalesApi.setHorarioSemanal(profesionalId, dias);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['horario-semanal', profesionalId] });
      qc.invalidateQueries({ queryKey: ['disponibilidad'] });
      toast.success(`Horario de ${nombre.split(' ')[0]} guardado`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = (n: number, patch: Partial<DiaEstado>) => setEstado((prev) => ({ ...(prev ?? base), [n]: { ...(prev ?? base)[n], ...patch } }));

  const invalido = DIAS.some((d) => ed[d.n].activo && ed[d.n].horaFin <= ed[d.n].horaInicio);
  const sinDias = DIAS.every((d) => !ed[d.n].activo);

  if (isLoading) return <div className="px-4 py-3 text-xs text-slate-400">Cargando horario…</div>;

  return (
    <div className="px-4 py-3 bg-slate-50/60 border-t border-slate-100 space-y-1.5">
      {DIAS.map((d) => {
        const st = ed[d.n];
        const malRango = st.activo && st.horaFin <= st.horaInicio;
        return (
          <div key={d.n} className="flex items-center gap-2.5">
            <label className="flex items-center gap-1.5 w-28 shrink-0 cursor-pointer">
              <input type="checkbox" checked={st.activo} onChange={(e) => set(d.n, { activo: e.target.checked })} />
              <span className={cn('text-xs', st.activo ? 'font-semibold text-slate-800' : 'text-slate-400')}>{d.label}</span>
            </label>
            {st.activo ? (
              <div className="flex items-center gap-1.5">
                <input type="time" step={1800} className={cn('input text-xs w-28 py-1', malRango && 'border-rose-400')} value={st.horaInicio} onChange={(e) => set(d.n, { horaInicio: e.target.value })} />
                <span className="text-slate-400 text-xs">a</span>
                <input type="time" step={1800} className={cn('input text-xs w-28 py-1', malRango && 'border-rose-400')} value={st.horaFin} onChange={(e) => set(d.n, { horaFin: e.target.value })} />
                {malRango && <span className="text-rose-500 text-xxs">fin ≤ inicio</span>}
              </div>
            ) : (
              <span className="text-xs text-slate-400">No trabaja</span>
            )}
          </div>
        );
      })}
      <div className="flex items-center gap-2 pt-1.5">
        <button
          onClick={() => guardar.mutate()}
          disabled={guardar.isPending || invalido || sinDias}
          className="btn btn-primary btn-sm disabled:opacity-50"
        >
          {guardar.isPending ? 'Guardando…' : 'Guardar horario'}
        </button>
        {sinDias && <span className="text-xxs text-amber-600">Marca al menos un día.</span>}
        <span className="text-xxs text-slate-400 ml-auto">Cambia la disponibilidad desde hoy en adelante.</span>
      </div>
    </div>
  );
}
