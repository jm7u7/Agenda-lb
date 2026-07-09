// Días especiales / Excepciones — herramienta unificada (admin + coordinadora).
// Para un domingo/feriado/horario extendido: marca con casillas QUIÉN trabaja en la
// sede ese día. Las de la sede → presencia (EntradaPodologa). Las de OTRA sede →
// cobertura de ese día (no las mueve de verdad; su sede base queda intacta).
// Soporta una fecha o un RANGO (aplica a cada día del rango).

import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format, parseISO, eachDayOfInterval, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { sedesApi, profesionalesApi, horariosApi, type PodologaDiaEspecial } from '../../api';
import { useAuthStore } from '../../stores/authStore';
import { cn } from '../../utils/cn';

function hoyISO() { return format(new Date(), 'yyyy-MM-dd'); }

export function DiasEspecialesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const puedeGestionar = useAuthStore(s => s.isCoordinadora());

  const [sedeSelId, setSedeSelId] = useState('');
  const [fecha, setFecha] = useState(hoyISO());       // fecha que se VE / edita
  const [fechaFin, setFechaFin] = useState('');       // '' = solo un día; si se llena, es rango
  const [horaInicio, setHoraInicio] = useState<'08:00' | '09:00'>('08:00');

  const { data: sedes = [] } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });
  const sedeId = sedeSelId || sedes[0]?.id || '';
  const sedeNombre = sedes.find(s => s.id === sedeId)?.nombre ?? '';

  // Días especiales REALES de la sede (excepciones abiertas próximas) — para elegir el
  // correcto en vez de adivinar la fecha (evita configurar el día equivocado).
  const { data: excepciones = [] } = useQuery({
    queryKey: ['excepciones-sede', sedeId],
    queryFn: () => horariosApi.excepciones(sedeId, hoyISO(), format(addDays(new Date(), 90), 'yyyy-MM-dd')),
    enabled: !!sedeId && puedeGestionar,
  });
  const diasEspeciales = useMemo(
    () => excepciones.filter(e => e.abierto && e.horaApertura && e.horaCierre).sort((a, b) => a.fecha.localeCompare(b.fecha)),
    [excepciones],
  );

  // Se ve/edita sobre la fecha inicial; el rango solo amplía a qué fechas se APLICA el cambio.
  const { data, isLoading } = useQuery({
    queryKey: ['dia-especial', sedeId, fecha],
    queryFn: () => profesionalesApi.diaEspecial(sedeId, fecha),
    enabled: !!sedeId && puedeGestionar,
  });

  // La entrada se ajusta SOLA al horario de apertura de la excepción (ej. domingo 09:00),
  // así el turno de quien marques coincide con la excepción, no con un 08:00 fijo.
  useEffect(() => {
    if (data?.abierto && (data.apertura === '08:00' || data.apertura === '09:00')) setHoraInicio(data.apertura);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.apertura, data?.abierto]);

  // Fechas a las que se aplica un cambio (una o rango).
  const fechasAplicar = useMemo(() => {
    if (!fechaFin || fechaFin <= fecha) return [fecha];
    return eachDayOfInterval({ start: parseISO(fecha), end: parseISO(fechaFin) }).map(d => format(d, 'yyyy-MM-dd'));
  }, [fecha, fechaFin]);

  const setMut = useMutation({
    mutationFn: (vars: { profesionalId: string; viene: boolean }) =>
      profesionalesApi.setDiaEspecial({ profesionalId: vars.profesionalId, sedeId, fechas: fechasAplicar, viene: vars.viene, horaInicio }),
    onSuccess: (r, vars) => {
      qc.invalidateQueries({ queryKey: ['dia-especial', sedeId, fecha] });
      qc.invalidateQueries({ queryKey: ['profesionales-sede'] }); // refresca columnas de la agenda
      const okN = r.resultados.length;
      const msg = fechasAplicar.length > 1 ? `${okN} día(s) actualizados` : (vars.viene ? 'Agregada' : 'Quitada');
      if (r.errores.length > 0) toast.error(`${r.errores.length} día(s) sin habilitar: ${r.errores[0].error}`, { duration: 6000 });
      else toast.success(msg);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!puedeGestionar) {
    return <div className="flex-1 flex items-center justify-center bg-slate-50 text-slate-400 text-sm">Solo la Coordinadora de Sedes (y el admin) pueden gestionar días especiales.</div>;
  }

  const habilitado = data?.abierto ?? false;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/herramientas')} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100" title="Volver">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center shrink-0"><span className="text-white text-lg">📅</span></div>
        <div>
          <h1 className="text-base font-bold text-slate-900">Días especiales / Excepciones</h1>
          <p className="text-xs text-slate-500">Elige qué podólogas trabajan un domingo, feriado u horario extendido — y trae de otras sedes</p>
        </div>
      </div>

      {/* Tabs de sede */}
      <div className="bg-white border-b border-slate-200 px-6 flex gap-0 overflow-x-auto">
        {sedes.map(s => (
          <button key={s.id} onClick={() => setSedeSelId(s.id)}
            className={cn('px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap',
              sedeId === s.id ? 'border-amber-500 text-amber-700' : 'border-transparent text-slate-500 hover:text-slate-700')}>
            {s.nombre}
          </button>
        ))}
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Días especiales reales de la sede — elige el correcto (evita el día equivocado) */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-bold text-slate-700 mb-2">Días especiales de {sedeNombre} <span className="font-normal text-slate-400">(próximos 90 días)</span></p>
          {diasEspeciales.length === 0 ? (
            <p className="text-xs text-slate-400">No hay días especiales abiertos. Primero ábrelos en la agenda (Horarios → excepción: domingo/feriado o cierre extendido).</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {diasEspeciales.map(e => {
                const activo = e.fecha === fecha;
                return (
                  <button key={e.id} onClick={() => { setFecha(e.fecha); setFechaFin(''); }}
                    className={cn('px-2.5 py-1.5 rounded-lg text-xs font-semibold border text-left transition-all',
                      activo ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-slate-700 border-slate-200 hover:border-amber-400')}>
                    <span className="capitalize">{format(parseISO(e.fecha), "EEE d MMM", { locale: es })}</span>
                    <span className={cn('ml-1 font-normal', activo ? 'text-amber-100' : 'text-slate-400')}>{e.horaApertura}–{e.horaCierre}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Fecha / rango */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-xs font-semibold text-slate-600">Día</label>
            <input type="date" value={fecha} onChange={e => e.target.value && setFecha(e.target.value)} className="input text-sm" />
            <span className="text-xs text-slate-400 capitalize">{format(parseISO(fecha), "EEEE d 'de' MMM", { locale: es })}</span>
            <span className="text-slate-300">→</span>
            <label className="text-xs font-semibold text-slate-600">Hasta (opcional)</label>
            <input type="date" value={fechaFin} min={fecha} onChange={e => setFechaFin(e.target.value)} className="input text-sm" />
            {fechaFin && fechaFin > fecha && <button onClick={() => setFechaFin('')} className="text-xxs text-slate-400 hover:underline">un solo día</button>}
          </div>
          {fechasAplicar.length > 1 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
              Los cambios se aplicarán a <b>{fechasAplicar.length} días</b> ({format(parseISO(fecha), 'd MMM', { locale: es })} – {format(parseISO(fechaFin), 'd MMM', { locale: es })}). Cada día debe estar habilitado (excepción abierta).
            </p>
          )}
          {/* Estado del día */}
          {data && (
            habilitado ? (
              <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1.5">
                ✅ {sedeNombre} abre este día {data.apertura}–{data.cierre}{data.nota ? ` · ${data.nota}` : ''}. Marca abajo quién viene.
              </p>
            ) : (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded-md px-2 py-1.5">
                ⚠ Este día NO está habilitado para {sedeNombre}. Ábrelo primero en la agenda (Horarios → excepción: domingo/feriado o cierre extendido).
              </p>
            )
          )}
          {/* Hora de entrada por defecto para lo que marques */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-600">Entrada:</span>
            {(['08:00', '09:00'] as const).map(h => (
              <button key={h} onClick={() => setHoraInicio(h)}
                className={cn('px-3 py-1 rounded-lg text-xs font-semibold border', horaInicio === h ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-slate-600 border-slate-200')}>{h}</button>
            ))}
            <span className="text-xxs text-slate-400">se aplica a quien marques ahora</span>
          </div>
        </div>

        {isLoading && <p className="text-center text-slate-400 py-8 text-sm">Cargando…</p>}

        {data && (
          <>
            {/* Podólogas de la sede */}
            <ListaPodologas
              titulo={`Podólogas de ${sedeNombre}`}
              subtitulo="Marca quién viene este día"
              podologas={data.propias}
              deshabilitado={!habilitado || setMut.isPending}
              onToggle={(id, viene) => setMut.mutate({ profesionalId: id, viene })}
            />

            {/* Traer de otra sede */}
            <ListaPodologas
              titulo="Traer de otra sede"
              subtitulo="Marca para que cubra este día aquí — su sede base no se toca"
              podologas={data.otras}
              deshabilitado={!habilitado || setMut.isPending}
              onToggle={(id, viene) => setMut.mutate({ profesionalId: id, viene })}
              mostrarSedeBase
            />
          </>
        )}
      </div>
    </div>
  );
}

// ─── Lista de casillas ────────────────────────────────────────────────────────
function ListaPodologas({ titulo, subtitulo, podologas, deshabilitado, onToggle, mostrarSedeBase = false }: {
  titulo: string;
  subtitulo: string;
  podologas: PodologaDiaEspecial[];
  deshabilitado: boolean;
  onToggle: (id: string, viene: boolean) => void;
  mostrarSedeBase?: boolean;
}) {
  const vienen = podologas.filter(p => p.viene).length;
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-slate-800">{titulo}</p>
          <p className="text-xxs text-slate-400">{subtitulo}</p>
        </div>
        <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">{vienen} vienen</span>
      </div>
      {podologas.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-slate-400">{mostrarSedeBase ? 'No hay podólogas de otras sedes' : 'No hay podólogas asignadas a esta sede'}</p>
      ) : (
        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
          {podologas.map(p => (
            <button key={p.id} type="button" disabled={deshabilitado}
              onClick={() => onToggle(p.id, !p.viene)}
              className={cn('w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors disabled:opacity-50',
                p.viene ? 'bg-amber-50' : 'hover:bg-slate-50')}>
              <span className={cn('w-4 h-4 rounded border flex items-center justify-center shrink-0', p.viene ? 'bg-amber-500 border-amber-500 text-white' : 'border-slate-300 bg-white')}>
                {p.viene && <span className="text-[10px] leading-none">✓</span>}
              </span>
              <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xxs font-bold shrink-0" style={{ backgroundColor: p.colorAvatar }}>
                {(p.nombres[0] ?? '') + (p.apellidos[0] ?? '')}
              </span>
              <span className={cn('flex-1 text-sm', p.viene ? 'font-semibold text-slate-800' : 'text-slate-600')}>
                {p.nombres.split(' ')[0]} {p.apellidos.split(' ')[0]}
              </span>
              {mostrarSedeBase && p.sedeBase && <span className="text-xxs text-slate-400">de {p.sedeBase}</span>}
              {p.viene && <span className="text-xxs text-amber-600">{p.horaEntrada}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
