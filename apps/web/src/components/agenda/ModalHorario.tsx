import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, addDays, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { horariosApi, type HorarioDia, type Excepcion } from '../../api';
import toast from 'react-hot-toast';
import { cn } from '../../utils/cn';

interface ModalHorarioProps {
  sedeId: string;
  sedeName: string;
  onClose: () => void;
}

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DIAS_FULL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const HORAS = ['07:00','07:30','08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30',
               '12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30',
               '17:00','17:30','18:00','18:30','19:00','19:30','20:00'];

// Próximas 4 semanas para excepciones rápidas
const hoy = new Date();
hoy.setHours(0,0,0,0);
const PROXIMAS_FECHAS = Array.from({ length: 28 }, (_, i) => addDays(hoy, i));

export function ModalHorario({ sedeId, sedeName, onClose }: ModalHorarioProps) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'semana' | 'excepciones'>('semana');

  // Formulario excepción rápida
  const [fechaExc, setFechaExc] = useState(format(hoy, 'yyyy-MM-dd'));
  const [abierto, setAbierto] = useState(true);
  const [apertura, setApertura] = useState('08:00');
  const [cierre, setCierre] = useState('18:00');
  const [nota, setNota] = useState('');

  const { data: horarioData } = useQuery({
    queryKey: ['horario', sedeId, format(hoy, 'yyyy-MM-dd')],
    queryFn: () => horariosApi.efectivo(sedeId, format(hoy, 'yyyy-MM-dd')),
  });

  const desdeStr = format(hoy, 'yyyy-MM-dd');
  const hastaStr = format(addDays(hoy, 60), 'yyyy-MM-dd');

  const { data: excepciones } = useQuery({
    queryKey: ['excepciones', sedeId, desdeStr],
    queryFn: () => horariosApi.excepciones(sedeId, desdeStr, hastaStr),
  });

  const guardarMut = useMutation({
    mutationFn: () => horariosApi.guardarExcepcion(sedeId, {
      fecha: fechaExc,
      abierto,
      horaApertura: abierto ? apertura : null,
      horaCierre: abierto ? cierre : null,
      nota: nota || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['excepciones', sedeId] });
      qc.invalidateQueries({ queryKey: ['horario', sedeId] });
      toast.success('Excepción guardada');
      setNota('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const eliminarMut = useMutation({
    mutationFn: (fecha: string) => horariosApi.eliminarExcepcion(sedeId, fecha),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['excepciones', sedeId] });
      qc.invalidateQueries({ queryKey: ['horario', sedeId] }); // refresca la agenda (vuelve al horario normal)
      toast.success('Excepción eliminada — vuelve al horario normal');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const horarioDefault = horarioData?.horarioDefault ?? {};

  // Presets rápidos de cierre
  const PRESETS_CIERRE = ['13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <p className="font-semibold text-slate-900">Horarios — {sedeName}</p>
            <p className="text-xs text-slate-500 mt-0.5">Gestiona apertura, cierre y excepciones</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 px-6">
          {(['semana', 'excepciones'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'py-2.5 px-1 mr-5 text-sm font-medium border-b-2 transition-all',
                tab === t
                  ? 'border-limablue-600 text-limablue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              )}
            >
              {t === 'semana' ? 'Horario semanal' : 'Excepciones'}
              {t === 'excepciones' && excepciones && excepciones.length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xxs font-semibold">
                  {excepciones.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* ── Tab: Horario semanal ── */}
          {tab === 'semana' && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 mb-3">Horario base por defecto. Para cambios de un día específico usa la pestaña <strong>Excepciones</strong>.</p>
              {DIAS.map((dia, i) => {
                const turno = horarioDefault[String(i)] as HorarioDia | undefined;
                const abierto = turno?.abierto !== false;
                return (
                  <div key={i} className="flex items-center gap-3 py-2 border-b border-slate-50">
                    <span className="w-8 text-sm font-medium text-slate-600">{dia}</span>
                    <span className="flex-1 text-sm font-medium text-slate-500">{DIAS_FULL[i]}</span>
                    {abierto && 'apertura' in (turno ?? {}) ? (
                      <span className="text-sm text-slate-800 font-mono tabular-nums">
                        {(turno as { apertura: string; cierre: string }).apertura}
                        <span className="text-slate-400 mx-1">→</span>
                        {(turno as { apertura: string; cierre: string }).cierre}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400 italic">Cerrado</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Tab: Excepciones ── */}
          {tab === 'excepciones' && (
            <div className="space-y-5">
              {/* Formulario nueva excepción */}
              <div className="bg-slate-50 rounded-xl p-4 space-y-4">
                <p className="text-sm font-semibold text-slate-700">Añadir excepción</p>

                {/* Selector de fecha rápido */}
                <div>
                  <p className="text-xs text-slate-500 mb-2">Fecha</p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {PROXIMAS_FECHAS.slice(0, 14).map(d => {
                      const str = format(d, 'yyyy-MM-dd');
                      const sel = str === fechaExc;
                      const esHoy = str === format(hoy, 'yyyy-MM-dd');
                      return (
                        <button
                          key={str}
                          onClick={() => setFechaExc(str)}
                          className={cn(
                            'px-2 py-1 rounded-lg text-xs border transition-all',
                            sel
                              ? 'bg-limablue-600 text-white border-limablue-600'
                              : 'bg-white text-slate-600 border-slate-200 hover:border-limablue-400'
                          )}
                        >
                          {esHoy ? 'Hoy' : format(d, 'EEE d', { locale: es })}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    type="date"
                    value={fechaExc}
                    onChange={e => setFechaExc(e.target.value)}
                    className="input text-sm w-full"
                  />
                  {fechaExc && (
                    <p className="text-xs text-slate-400 mt-1">
                      {format(parseISO(fechaExc), "EEEE d 'de' MMMM", { locale: es })}
                    </p>
                  )}
                </div>

                {/* Abierto / Cerrado */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setAbierto(true)}
                    className={cn('flex-1 py-2 rounded-lg text-sm font-medium border transition-all',
                      abierto ? 'bg-green-500 text-white border-green-500' : 'bg-white text-slate-600 border-slate-200 hover:border-green-300')}
                  >
                    Abierto
                  </button>
                  <button
                    onClick={() => setAbierto(false)}
                    className={cn('flex-1 py-2 rounded-lg text-sm font-medium border transition-all',
                      !abierto ? 'bg-red-400 text-white border-red-400' : 'bg-white text-slate-600 border-slate-200 hover:border-red-300')}
                  >
                    Cerrado
                  </button>
                </div>

                {/* Horario si abierto */}
                {abierto && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs text-slate-500 mb-1">Apertura</p>
                        <select value={apertura} onChange={e => setApertura(e.target.value)} className="input text-sm w-full">
                          {HORAS.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 mb-1">Cierre</p>
                        <select value={cierre} onChange={e => setCierre(e.target.value)} className="input text-sm w-full">
                          {HORAS.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                    </div>
                    {/* Presets de cierre rápido */}
                    <div>
                      <p className="text-xs text-slate-400 mb-1.5">Cierre rápido:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {PRESETS_CIERRE.map(h => (
                          <button
                            key={h}
                            onClick={() => setCierre(h)}
                            className={cn(
                              'px-2.5 py-0.5 rounded-full text-xs border transition-all',
                              cierre === h
                                ? 'bg-limablue-600 text-white border-limablue-600'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-limablue-400'
                            )}
                          >
                            {h}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Nota opcional */}
                <input
                  className="input text-sm w-full"
                  placeholder="Nota (ej: Feriado, Capacitación, Cierre anticipado…)"
                  value={nota}
                  onChange={e => setNota(e.target.value)}
                />

                {/* Aviso de rango inválido (apertura ≥ cierre) — evita guardar algo que dejaría la agenda en blanco */}
                {abierto && apertura >= cierre && (
                  <p className="text-xs text-red-500 font-medium">La hora de apertura debe ser anterior a la de cierre.</p>
                )}

                <button
                  onClick={() => guardarMut.mutate()}
                  disabled={guardarMut.isPending || (abierto && apertura >= cierre)}
                  className="btn-primary btn-sm w-full disabled:opacity-50"
                >
                  {guardarMut.isPending ? 'Guardando…' : 'Guardar excepción'}
                </button>
              </div>

              {/* Lista de excepciones futuras */}
              {excepciones && excepciones.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Próximas excepciones</p>
                  <div className="space-y-2">
                    {excepciones.map((exc: Excepcion) => (
                      <div key={exc.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-white">
                        <div className={cn('w-2 h-2 rounded-full shrink-0', exc.abierto ? 'bg-green-400' : 'bg-red-400')} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800">
                            {format(parseISO(exc.fecha), "EEEE d 'de' MMMM", { locale: es })}
                          </p>
                          <p className="text-xs text-slate-500">
                            {exc.abierto
                              ? `${exc.horaApertura} → ${exc.horaCierre}`
                              : 'Cerrado'}
                            {exc.nota && ` · ${exc.nota}`}
                          </p>
                        </div>
                        <button
                          onClick={() => eliminarMut.mutate(exc.fecha)}
                          className="text-slate-300 hover:text-red-400 text-lg leading-none transition-colors"
                          title="Eliminar excepción"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {excepciones?.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-4">Sin excepciones programadas</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
