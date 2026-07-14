// Ajustes por fecha (antes "Horarios de entrada"). CAPA 2 del modelo de horarios:
// overrides de turno de días CONCRETOS — entrada 8/9 de Lun-Vie y presencia en días
// especiales (domingo/feriado habilitado). A diferencia del modelo viejo, el override
// afecta la agenda Y los horarios reservables (una sola verdad: `turnosDelDia`).
// Se muestra dentro de la herramienta unificada HorariosPage.

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format, addDays, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { sedesApi, profesionalesApi, type PodologaSemana, type DiaEntrada } from '../../api';
import { cn } from '../../utils/cn';

const DIA_LABEL = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function hoyISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

// ¿El error es la salvaguarda de citas fuera del nuevo turno? → ofrecer forzar.
function esConflictoCitas(e: Error): boolean {
  return (e as Error & { data?: { error?: string } }).data?.error === 'HORARIO_CONFLICTO_CITAS';
}

// ── Fila de podóloga: 5 días con toggle 8/9 + acción de semana completa ────────
function FilaPodologa({ p, sedeId, semanaRef }: { p: PodologaSemana; sedeId: string; semanaRef: string }) {
  const qc = useQueryClient();
  const iniciales = `${p.nombres[0] ?? ''}${p.apellidos[0] ?? ''}`.toUpperCase();

  const mut = useMutation({
    mutationFn: ({ fechas, hora, forzar }: { fechas: string[]; hora: '08:00' | '09:00'; forzar?: boolean }) =>
      profesionalesApi.setEntrada(p.id, fechas, hora, forzar),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['horarios-entrada', sedeId, semanaRef] });
      // Refrescar la AGENDA y los SLOTS: el override de entrada define el turno real del día.
      qc.invalidateQueries({ queryKey: ['profesionales-sede'] });
      qc.invalidateQueries({ queryKey: ['disponibilidad'] });
    },
    onError: (e: Error, vars) => {
      if (esConflictoCitas(e)) {
        if (window.confirm(`${e.message}\n\n¿Aplicar la entrada de todos modos?`)) {
          mut.mutate({ ...vars, forzar: true });
          return;
        }
        return;
      }
      toast.error(e.message);
    },
  });

  const nombreCorto = `${p.nombres.split(' ')[0]} ${p.apellidos.split(' ')[0]}`;
  const diasLaborables = p.dias.filter(d => d.trabaja);
  const todasIguales = diasLaborables.every(d => d.horaEntrada === diasLaborables[0]?.horaEntrada);

  const setSemana = (hora: '08:00' | '09:00') => {
    // Solo los días que la persona TRABAJA (semana tipo): un toggle masivo no debe
    // crear overrides en sus días libres.
    mut.mutate(
      { fechas: diasLaborables.map(d => d.fecha), hora },
      { onSuccess: () => toast.success(`${nombreCorto}: su semana laboral entra ${hora === '08:00' ? 'a las 8:00' : 'a las 9:00'}`) },
    );
  };
  const toggleDia = (d: DiaEntrada) => {
    const nueva = d.horaEntrada === '08:00' ? '09:00' : '08:00';
    mut.mutate({ fechas: [d.fecha], hora: nueva });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: p.colorAvatar }}>
          {iniciales}
        </div>
        <p className="text-sm font-semibold text-slate-900 flex-1 min-w-0 truncate">{nombreCorto}</p>
        {/* Acción de semana completa */}
        <div className="flex items-center gap-1.5">
          <span className="text-xxs text-slate-400 mr-0.5">Toda la semana:</span>
          {(['08:00', '09:00'] as const).map(h => (
            <button
              key={h}
              onClick={() => setSemana(h)}
              disabled={mut.isPending || (todasIguales && p.dias[0]?.horaEntrada === h)}
              className="px-2 py-1 text-xxs font-semibold rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-default transition-colors"
            >
              {h}
            </button>
          ))}
        </div>
      </div>

      {/* 5 días Lun-Vie — clic para alternar 8/9 (override de ese día). Sábado siempre 08:00.
          Los días sin horario base ("No trabaja") no son toggleables: el override no aplica ahí. */}
      <div className="grid grid-cols-5 gap-2">
        {p.dias.map(d => {
          if (!d.trabaja) {
            return (
              <div
                key={d.fecha}
                title={`${DIA_LABEL[d.diaSemana]} ${format(parseISO(d.fecha), 'd MMM', { locale: es })} · no trabaja este día (ver Semana tipo)`}
                className="flex flex-col items-center py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
              >
                <span className="text-xxs font-medium opacity-70">{DIA_LABEL[d.diaSemana]}</span>
                <span className="text-xxs font-semibold">No trabaja</span>
              </div>
            );
          }
          const es8 = d.horaEntrada === '08:00';
          return (
            <button
              key={d.fecha}
              onClick={() => toggleDia(d)}
              disabled={mut.isPending}
              title={`${DIA_LABEL[d.diaSemana]} ${format(parseISO(d.fecha), 'd MMM', { locale: es })} · clic para cambiar a ${es8 ? '09:00' : '08:00'}`}
              className={cn(
                'flex flex-col items-center py-1.5 rounded-lg border transition-all disabled:opacity-50',
                es8
                  ? 'bg-limablue-50 border-limablue-300 text-limablue-700'
                  : 'bg-amber-50 border-amber-300 text-amber-700',
              )}
            >
              <span className="text-xxs font-medium opacity-70">{DIA_LABEL[d.diaSemana]}</span>
              <span className="text-xs font-bold">{d.horaEntrada}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Panel "Día especial": marcar qué podólogas vienen un domingo/feriado habilitado ──
function PanelDiaEspecial({ sedeId }: { sedeId: string }) {
  const qc = useQueryClient();
  const [fecha, setFecha] = useState('');

  const { data, isFetching } = useQuery({
    queryKey: ['personal-excepcion', sedeId, fecha],
    queryFn: () => profesionalesApi.personalExcepcion(sedeId, fecha),
    enabled: !!sedeId && !!fecha,
  });

  const mut = useMutation({
    mutationFn: ({ id, presente, hora }: { id: string; presente: boolean; hora?: '08:00' | '09:00' }) =>
      profesionalesApi.setPresenciaExcepcion(id, sedeId, fecha, presente, hora),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['personal-excepcion', sedeId, fecha] });
      qc.invalidateQueries({ queryKey: ['profesionales-sede'] });
      qc.invalidateQueries({ queryKey: ['disponibilidad'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-lg leading-none">📅</span>
        <h3 className="text-sm font-bold text-slate-800">Día especial (domingo o feriado habilitado)</h3>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">
        Si abriste un domingo/feriado en la agenda (Horarios → excepción), aquí eliges <strong>qué podólogas vienen</strong> ese día.
        Solo las marcadas quedarán agendables; las demás no aparecen en la agenda de ese día.
      </p>
      <input
        type="date"
        className="input text-sm w-full"
        value={fecha}
        onChange={e => setFecha(e.target.value)}
      />

      {!fecha ? null : isFetching && !data ? (
        <p className="text-xs text-slate-400">Cargando…</p>
      ) : !data?.abierto ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
          Ese día la sede <strong>no está habilitada</strong>. Ábrelo primero en la agenda → <strong>Horarios</strong> (excepción), y luego marca aquí al personal.
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-emerald-700 font-medium">
            La sede atiende ese día {data.apertura}–{data.cierre}. Marca quién viene:
          </p>
          {data.podologas.length === 0 ? (
            <p className="text-xs text-slate-400">No hay podólogas asignadas a esta sede.</p>
          ) : data.podologas.map(p => (
            <div key={p.id} className="flex items-center gap-2 border border-slate-100 rounded-lg px-3 py-2">
              <button
                onClick={() => mut.mutate({ id: p.id, presente: !p.presente, hora: p.horaEntrada as '08:00' | '09:00' })}
                disabled={mut.isPending}
                className={cn('w-5 h-5 rounded border flex items-center justify-center text-xs shrink-0 transition-colors',
                  p.presente ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-white border-slate-300 text-transparent')}
                title={p.presente ? 'Viene — clic para quitar' : 'No viene — clic para marcar'}
              >✓</button>
              <span className="flex-1 text-sm text-slate-700">{p.nombres} {p.apellidos}</span>
              {p.presente && (
                <div className="flex gap-1">
                  {(['08:00', '09:00'] as const).map(h => (
                    <button key={h}
                      onClick={() => mut.mutate({ id: p.id, presente: true, hora: h })}
                      disabled={mut.isPending || p.horaEntrada === h}
                      className={cn('px-2 py-0.5 rounded text-xxs font-semibold border transition-colors',
                        p.horaEntrada === h
                          ? (h === '08:00' ? 'bg-sky-500 border-sky-500 text-white' : 'bg-amber-500 border-amber-500 text-white')
                          : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300')}>
                      {h}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Contenido de la pestaña "Ajustes por fecha" ────────────────────────────────
export function AjustesFechaContent() {
  const [sedeSelId, setSedeSelId] = useState('');
  const [semanaRef, setSemanaRef] = useState<string>(hoyISO());

  const { data: sedes = [] } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });
  const sedeId = sedeSelId || sedes[0]?.id || '';

  const { data, isLoading } = useQuery({
    queryKey: ['horarios-entrada', sedeId, semanaRef],
    queryFn: () => profesionalesApi.listarHorariosEntrada(sedeId, semanaRef),
    enabled: !!sedeId,
  });

  const rangoSemana = data
    ? `${format(parseISO(data.semana.lunes), "d 'de' MMM", { locale: es })} – ${format(parseISO(data.semana.viernes), "d 'de' MMM yyyy", { locale: es })}`
    : '';
  const esSemanaActual = data ? parseISO(data.semana.lunes) <= new Date() && new Date() <= addDays(parseISO(data.semana.viernes), 3) : false;

  return (
    <>
      {/* Tabs de sede */}
      <div className="bg-white border-b border-slate-200 px-6 flex gap-0 overflow-x-auto">
        {sedes.map(s => (
          <button key={s.id} onClick={() => setSedeSelId(s.id)}
            className={cn('px-4 py-2.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap',
              sedeId === s.id ? 'border-sky-500 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300')}>
            {s.nombre}
          </button>
        ))}
      </div>

      {/* Selector de semana */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-center gap-3">
        <button onClick={() => setSemanaRef(format(addDays(parseISO(semanaRef), -7), 'yyyy-MM-dd'))}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-all" title="Semana anterior">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="text-center min-w-[220px]">
          <p className="text-sm font-semibold text-slate-800 capitalize">{rangoSemana || '—'}</p>
          {esSemanaActual && <span className="text-xxs font-semibold text-sky-600">Semana actual</span>}
        </div>
        <button onClick={() => setSemanaRef(format(addDays(parseISO(semanaRef), 7), 'yyyy-MM-dd'))}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-all" title="Semana siguiente">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
        {!esSemanaActual && (
          <button onClick={() => setSemanaRef(hoyISO())} className="ml-2 px-2.5 py-1 text-xxs font-semibold text-sky-700 bg-sky-50 border border-sky-200 rounded-md hover:bg-sky-100 transition-colors">
            Hoy
          </button>
        )}
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 flex gap-3">
          <span className="text-lg leading-none">💡</span>
          <p className="text-xs text-sky-800 leading-relaxed">
            Elige la <strong>semana</strong> arriba y define la entrada de cada podóloga (Lun–Vie). Usa <strong>“Toda la semana”</strong>
            para fijar los 5 días de una vez, o haz <strong>clic en un día</strong> para un ajuste puntual (azul = 8:00, ámbar = 9:00).
            Los <strong>sábados la entrada es siempre 8:00</strong>. El cambio se aplica de inmediato en la agenda
            <strong> y en los horarios reservables</strong> de esa fecha.
          </p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" /></div>
        ) : !data || data.podologas.length === 0 ? (
          <div className="text-center py-12 text-slate-400"><p className="text-2xl mb-2">🕗</p><p className="text-sm">No hay podólogas en esta sede</p></div>
        ) : (
          <div className="space-y-2">
            {data.podologas.map(p => <FilaPodologa key={p.id} p={p} sedeId={sedeId} semanaRef={semanaRef} />)}
          </div>
        )}

        {sedeId && <PanelDiaEspecial sedeId={sedeId} />}
      </div>
    </>
  );
}
