import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { sedesApi, profesionalesApi } from '../../api';
import { permisosApi, type Permiso } from '../../api/permisos';
import { useAuthStore } from '../../stores/authStore';
import { cn } from '../../utils/cn';

// Opciones de hora 08:00 … 20:00 cada 30 min
const HORAS: string[] = [];
for (let m = 8 * 60; m <= 20 * 60; m += 30) {
  HORAS.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
}

function hoyISO() { return format(new Date(), 'yyyy-MM-dd'); }
const tipoLabel = (t: string) => (t === 'podologa' ? 'Podóloga' : t === 'fisioterapeuta' ? 'Fisioterapeuta' : t === 'medico' ? 'Baropodometría' : t);

export function PermisosPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const puedeGestionar = useAuthStore(s => s.isCoordinadora()); // admin + coordinadora_sedes

  const [sedeSelId, setSedeSelId] = useState('');
  const [fecha, setFecha] = useState<string>(hoyISO());

  // Formulario — se puede bloquear a uno o VARIOS profesionales a la vez.
  const [profesionalIds, setProfesionalIds] = useState<string[]>([]);
  const toggleProf = (id: string) => setProfesionalIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const [desde, setDesde] = useState('09:00');
  const [hasta, setHasta] = useState('13:00');
  const [motivo, setMotivo] = useState('');
  // Modo del formulario: bloqueo individual o reunión de Daniel y Yasica (ambas agendas).
  const [modo, setModo] = useState<'individual' | 'reunion'>('individual');
  // Destinatario de la reunión: 3 escenarios (solo Daniel, solo Yasica, o ambos juntos).
  const [destinatario, setDestinatario] = useState<'daniel' | 'yasica' | 'ambos'>('ambos');
  // Pacientes en conflicto cuando el bloqueo es rechazado (CITAS_EN_RANGO).
  const [citasConflicto, setCitasConflicto] = useState<{ horaInicio: string; paciente: string; telefono: string; servicio: string; estado: string }[]>([]);

  const { data: sedes = [] } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });
  const sedeId = sedeSelId || sedes[0]?.id || '';

  const { data: profesionales = [] } = useQuery({
    queryKey: ['profesionales-sede', sedeId, fecha],
    queryFn: () => profesionalesApi.listar({ sedeId, fecha, activo: true }),
    enabled: !!sedeId && puedeGestionar,
  });
  // Bloqueables: podólogas, fisioterapeutas y baro (médico/máquina "Baro N") — para
  // bloquear baro cuando hay reunión de médicos y no pueden atender.
  const elegibles = useMemo(
    () => profesionales.filter(p => p.tipo === 'podologa' || p.tipo === 'fisioterapeuta' || p.tipo === 'medico'),
    [profesionales],
  );

  const { data: permisos = [], isLoading } = useQuery({
    queryKey: ['permisos', sedeId, fecha],
    queryFn: () => permisosApi.listarPorFecha(sedeId, fecha),
    enabled: !!sedeId && puedeGestionar,
  });

  const crearMut = useMutation({
    mutationFn: () => permisosApi.crearMultiple({ profesionalIds, sedeId, fecha, horaInicio: desde, horaFin: hasta, motivo: motivo.trim() }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['permisos', sedeId, fecha] });
      qc.invalidateQueries({ queryKey: ['permisos-agenda'] });
      // Bloqueados los libres; los que tienen pacientes se reportan (nunca se bloquean).
      const conflictos = r.conflictos.flatMap(c => c.citas.map(x => ({ ...x, paciente: `${c.nombre}: ${x.paciente}` })));
      setCitasConflicto(conflictos);
      if (r.creados.length > 0) {
        toast.success(`Bloqueado(s): ${r.creados.map(c => c.nombre).join(', ')}`
          + (r.conflictos.length > 0 ? ` · No se pudo con ${r.conflictos.map(c => c.nombre).join(', ')} (tienen pacientes)` : ''));
        // Deseleccionar solo a los que SÍ se bloquearon; los con conflicto quedan marcados para gestionarlos.
        setProfesionalIds(r.conflictos.map(c => c.profesionalId));
        if (r.conflictos.length === 0) setMotivo('');
      } else {
        toast.error(`Ninguno se bloqueó: ${r.conflictos.map(c => c.nombre).join(', ')} tienen pacientes en ese rango`);
      }
    },
    onError: (e: Error) => { setCitasConflicto([]); toast.error(e.message); },
  });

  const crearReunionMut = useMutation({
    mutationFn: () => permisosApi.crearReunion({ fecha, horaInicio: desde, horaFin: hasta, motivo: motivo.trim(), destinatario }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['permisos'] });
      qc.invalidateQueries({ queryKey: ['permisos-agenda'] });
      toast.success(`Reunión agendada en ${r.profesionales.join(' y ')}`);
      setMotivo(''); setCitasConflicto([]);
    },
    onError: (e: Error & { data?: { citas?: typeof citasConflicto } }) => {
      if (e.data?.citas?.length) { setCitasConflicto(e.data.citas); toast.error('Hay pacientes agendados en ese rango'); }
      else { setCitasConflicto([]); toast.error(e.message); }
    },
  });

  const eliminarMut = useMutation({
    mutationFn: (id: string) => permisosApi.eliminar(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['permisos', sedeId, fecha] });
      qc.invalidateQueries({ queryKey: ['permisos-agenda'] });
      toast.success('Permiso eliminado');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!puedeGestionar) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50 text-slate-400 text-sm">
        Solo la Coordinadora de Sedes (y el admin) pueden gestionar permisos.
      </div>
    );
  }

  const valido = (modo === 'reunion' || profesionalIds.length > 0) && !!desde && !!hasta && hasta > desde && motivo.trim().length >= 3;
  const enviando = crearMut.isPending || crearReunionMut.isPending;
  const enviar = () => (modo === 'reunion' ? crearReunionMut.mutate() : crearMut.mutate());

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/herramientas')} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-all" title="Volver a Herramientas">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="w-9 h-9 rounded-xl bg-rose-500 flex items-center justify-center shrink-0"><span className="text-white text-lg">🚫</span></div>
        <div>
          <h1 className="text-base font-bold text-slate-900">Permisos / Bloqueos</h1>
          <p className="text-xs text-slate-500">Bloquea a una podóloga, fisioterapeuta o baropodometría en un rango horario</p>
        </div>
      </div>

      {/* Tabs de sede */}
      <div className="bg-white border-b border-slate-200 px-6 flex gap-0 overflow-x-auto">
        {sedes.map(s => (
          <button key={s.id} onClick={() => setSedeSelId(s.id)}
            className={cn('px-4 py-2.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap',
              sedeId === s.id ? 'border-rose-500 text-rose-700' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300')}>
            {s.nombre}
          </button>
        ))}
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Fecha */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-slate-600">Día</label>
          <input type="date" value={fecha} onChange={e => e.target.value && setFecha(e.target.value)} className="input text-sm" />
          <span className="text-xs text-slate-400 capitalize">{format(parseISO(fecha), "EEEE d 'de' MMMM", { locale: es })}</span>
        </div>

        {/* Formulario nuevo permiso */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Nuevo bloqueo</p>

          {/* Tipo de bloqueo */}
          <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
            {([
              { id: 'individual', label: '🚫 Permiso individual' },
              { id: 'reunion', label: '🤝 Reunión (Daniel y Yasica)' },
            ] as { id: 'individual' | 'reunion'; label: string }[]).map(opt => (
              <button
                key={opt.id}
                onClick={() => {
                  setModo(opt.id);
                  setCitasConflicto([]);
                  // Reunión → la sede de Daniel y Yasica (One) se selecciona sola, para que la
                  // lista del día muestre su sede y no quede "pegada" en otra (ej. Lince).
                  if (opt.id === 'reunion') {
                    const one = sedes.find(s => s.nombre === 'One');
                    if (one) setSedeSelId(one.id);
                  }
                }}
                className={cn('flex-1 py-1.5 px-2 rounded-md text-xs font-semibold transition-all',
                  modo === opt.id ? 'bg-white text-rose-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {modo === 'individual' ? (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Profesional(es) <span className="font-normal text-slate-400">— marca uno o varios</span>
                </label>
                {elegibles.length > 0 && (
                  <div className="flex gap-2 text-xxs">
                    <button type="button" onClick={() => { setProfesionalIds(elegibles.map(p => p.id)); setCitasConflicto([]); }} className="text-rose-600 hover:underline font-semibold">Todos</button>
                    {profesionalIds.length > 0 && <button type="button" onClick={() => { setProfesionalIds([]); setCitasConflicto([]); }} className="text-slate-400 hover:underline">Ninguno</button>}
                  </div>
                )}
              </div>
              <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                {elegibles.map(p => {
                  const marcado = profesionalIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { toggleProf(p.id); setCitasConflicto([]); }}
                      className={cn('w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors', marcado ? 'bg-rose-50' : 'hover:bg-slate-50')}
                    >
                      <span className={cn('w-4 h-4 rounded border flex items-center justify-center shrink-0', marcado ? 'bg-rose-500 border-rose-500 text-white' : 'border-slate-300 bg-white')}>
                        {marcado && <span className="text-[10px] leading-none">✓</span>}
                      </span>
                      <span className={cn('flex-1', marcado ? 'font-semibold text-slate-800' : 'text-slate-600')}>
                        {p.nombres.split(' ')[0]} {p.apellidos.split(' ')[0]}
                      </span>
                      <span className={cn('text-xxs', p.tipo === 'medico' ? 'text-teal-600 font-semibold' : 'text-slate-400')}>{tipoLabel(p.tipo)}</span>
                    </button>
                  );
                })}
              </div>
              {elegibles.length === 0 && <p className="mt-1 text-xxs text-slate-400">No hay profesionales bloqueables en esta sede.</p>}
              {profesionalIds.length > 0 && <p className="mt-1 text-xxs text-slate-500">{profesionalIds.length} seleccionado(s) — se bloquearán en el mismo rango.</p>}
            </div>
          ) : (
            <div className="space-y-2">
              {/* ¿Para quién? — 3 escenarios: solo Daniel, solo Yasica, o ambos juntos */}
              <label className="block text-xs font-semibold text-slate-700">¿Para quién es la reunión?</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { id: 'daniel', label: 'Solo Daniel' },
                  { id: 'yasica', label: 'Solo Yasica' },
                  { id: 'ambos', label: 'Ambos juntos' },
                ] as { id: 'daniel' | 'yasica' | 'ambos'; label: string }[]).map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => { setDestinatario(opt.id); setCitasConflicto([]); }}
                    className={cn('py-2 px-2 rounded-lg text-xs font-semibold border transition-all',
                      destinatario === opt.id ? 'bg-violet-600 text-white border-violet-600 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300')}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2.5 text-xs text-violet-800">
                🤝 Se bloqueará el horario en {destinatario === 'ambos'
                  ? <>las agendas de <b>Daniel Doy</b> y <b>Yasica Doy</b></>
                  : <>la agenda de <b>{destinatario === 'daniel' ? 'Daniel Doy' : 'Yasica Doy'}</b></>
                } (en su sede vigente). El texto del motivo aparecerá en la reserva.
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Desde</label>
              <select value={desde} onChange={e => setDesde(e.target.value)} className="input w-full text-sm">
                {HORAS.slice(0, -1).map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Hasta</label>
              <select value={hasta} onChange={e => setHasta(e.target.value)} className="input w-full text-sm">
                {HORAS.filter(h => h > desde).map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              {modo === 'reunion' ? 'Texto de la reunión' : 'Motivo'}
            </label>
            <input type="text" value={motivo} onChange={e => setMotivo(e.target.value)}
              placeholder={modo === 'reunion' ? 'Ej: Reunión de coordinación mensual' : 'Permiso médico, trámite personal…'}
              className="input w-full text-sm" maxLength={200} />
          </div>

          <button
            onClick={enviar}
            disabled={!valido || enviando}
            className={cn('w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-colors',
              modo === 'reunion' ? 'bg-violet-600 hover:bg-violet-700' : 'bg-rose-600 hover:bg-rose-700')}
          >
            {enviando
              ? (modo === 'reunion' ? 'Agendando reunión…' : 'Bloqueando…')
              : (modo === 'reunion'
                  ? (destinatario === 'ambos' ? '🤝 Agendar reunión en ambas agendas' : `🤝 Agendar reunión de ${destinatario === 'daniel' ? 'Daniel' : 'Yasica'}`)
                  : `🚫 Bloquear horario${profesionalIds.length > 1 ? ` (${profesionalIds.length})` : ''}`)}
          </button>

          {/* Pacientes en el rango: por qué NO se pudo bloquear a esos profesionales */}
          {citasConflicto.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2">
              <p className="text-xs font-bold text-amber-800">
                No se pudo bloquear a quien tiene pacientes en ese rango ({citasConflicto.length} cita(s)). Reprograma o cancela sus citas primero.
              </p>
              <ul className="space-y-1">
                {citasConflicto.map((c, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-xs bg-white border border-amber-100 rounded-lg px-2.5 py-1.5">
                    <span className="font-semibold text-slate-700 tabular-nums">{c.horaInicio}</span>
                    <span className="flex-1 text-slate-700 truncate">{c.paciente}</span>
                    <span className="text-slate-400 truncate hidden sm:inline">{c.servicio}</span>
                    <span className="text-slate-400">{c.telefono}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Lista de permisos del día */}
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest px-1">Permisos del día</p>
          {isLoading ? (
            <div className="flex justify-center py-8"><div className="w-7 h-7 border-2 border-rose-400 border-t-transparent rounded-full animate-spin" /></div>
          ) : permisos.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">Sin permisos registrados para este día.</p>
          ) : (
            permisos.map((p: Permiso) => {
              const iniciales = `${p.profesional.nombres[0] ?? ''}${p.profesional.apellidos[0] ?? ''}`.toUpperCase();
              const reunion = !!p.esReunion;
              return (
                <div key={p.id} className={cn('rounded-xl p-4 flex items-center gap-3 border', reunion ? 'bg-emerald-50/60 border-emerald-200' : 'bg-white border-slate-200')}>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ backgroundColor: p.profesional.colorAvatar }}>{iniciales}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                      {p.profesional.nombres.split(' ')[0]} {p.profesional.apellidos.split(' ')[0]}
                      <span className="font-normal text-slate-400"> · {tipoLabel(p.profesional.tipo)}</span>
                      {reunion && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-600 text-white">🤝 Reunión</span>}
                    </p>
                    <p className={cn('text-xs font-medium mt-0.5', reunion ? 'text-emerald-700' : 'text-rose-700')}>{reunion ? '🤝' : '🚫'} {p.horaInicio} – {p.horaFin}</p>
                    <p className="text-xs text-slate-500 truncate">{p.motivo}</p>
                  </div>
                  <button
                    onClick={() => eliminarMut.mutate(p.id)}
                    disabled={eliminarMut.isPending}
                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all disabled:opacity-50"
                    title="Eliminar permiso"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
