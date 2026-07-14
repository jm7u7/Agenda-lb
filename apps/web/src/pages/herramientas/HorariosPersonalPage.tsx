// Semana tipo (antes "Horarios del personal"). Define el horario semanal PERMANENTE
// de cada trabajador: qué días y en qué rango horario trabaja, vigente hasta editarlo.
// Es la CAPA 1 del modelo de horarios; se muestra dentro de la herramienta unificada
// HorariosPage. Distinto de Permisos/Bloqueos (ausencias puntuales) y de los ajustes
// por fecha (capa 2: entrada 8/9 y días especiales).
// Usa PUT /profesionales/:id/horario (horarioService: audit + caché + tiempo real).

import { useState, useMemo } from 'react';
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

export function SemanaTipoContent() {
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
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 flex gap-3">
        <span className="text-lg leading-none">💡</span>
        <p className="text-xs text-teal-800 leading-relaxed">
          Este es el horario <strong>permanente</strong> de cada persona (hasta volver a editarlo) y define
          los horarios <strong>reservables</strong> en la agenda. Para cambiar la entrada de un día concreto
          usa la pestaña <strong>Ajustes por fecha</strong>; para ausencias puntuales usa <strong>Permisos</strong>.
        </p>
      </div>

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
    mutationFn: ({ forzar }: { forzar?: boolean }) => {
      const dias = DIAS.filter((d) => ed[d.n].activo).map((d) => ({ diaSemana: d.n, horaInicio: ed[d.n].horaInicio, horaFin: ed[d.n].horaFin }));
      return profesionalesApi.setHorarioSemanal(profesionalId, dias, forzar);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['horario-semanal', profesionalId] });
      qc.invalidateQueries({ queryKey: ['profesionales-sede'] });
      qc.invalidateQueries({ queryKey: ['disponibilidad'] });
      toast.success(`Horario de ${nombre.split(' ')[0]} guardado`);
    },
    onError: (e: Error) => {
      // Salvaguarda del backend: hay citas que quedarían FUERA del nuevo turno.
      // Se muestra el detalle y se ofrece aplicar de todos modos (forzar).
      if ((e as Error & { data?: { error?: string } }).data?.error === 'HORARIO_CONFLICTO_CITAS') {
        if (window.confirm(`${e.message}\n\n¿Aplicar el horario de todos modos?`)) {
          guardar.mutate({ forzar: true });
          return;
        }
      }
      toast.error(e.message);
    },
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
          onClick={() => guardar.mutate({})}
          disabled={guardar.isPending || invalido || sinDias}
          className="btn btn-primary btn-sm disabled:opacity-50"
        >
          {guardar.isPending ? 'Guardando…' : 'Guardar horario'}
        </button>
        {sinDias && <span className="text-xxs text-amber-600">Marca al menos un día.</span>}
        <span className="text-xxs text-slate-400 ml-auto">Cambia la agenda y la disponibilidad desde hoy en adelante.</span>
      </div>
    </div>
  );
}
