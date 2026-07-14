import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { sedesApi } from '../../api';
import { composicionSedeApi, type PersonaRoster, type SedeComposicion } from '../../api/composicionSede';
import { useAuthStore } from '../../stores/authStore';
import { cn } from '../../utils/cn';

function mesActualISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function rangoMesISO(mes: string) {
  const [y, m] = mes.split('-').map(Number);
  const fin = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
  return { inicio: `${mes}-01`, fin };
}

// ── Grupo de personas dentro de una sede (podólogas / fisios / doctores / recepcionistas) ──
function GrupoPersonas({ titulo, personas, color }: { titulo: string; personas: PersonaRoster[]; color: string }) {
  return (
    <div>
      <p className={cn('text-xs font-bold uppercase tracking-wide mb-1.5', color)}>{titulo} <span className="text-slate-400 font-semibold">({personas.length})</span></p>
      {personas.length === 0 ? (
        <p className="text-xs text-slate-400 italic pl-1">— sin personal —</p>
      ) : (
        <ul className="space-y-1">
          {personas.map((p, i) => (
            <li key={`${p.id}-${i}`} className="flex items-center justify-between gap-2 text-xs bg-slate-50 rounded-lg px-2.5 py-1.5">
              <span className="font-medium text-slate-700 truncate">{p.nombre}</span>
              <span className="text-slate-400 tabular-nums shrink-0">
                {p.indefinido ? `desde ${p.desde}` : `${p.desde} – ${p.hasta}`}
                {p.indefinido && <span className="ml-1 text-[10px] text-slate-400">(indef.)</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ComposicionSedePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const puedeGestionar = useAuthStore(s => s.isCoordinadora()); // admin + coordinadora_sedes

  const [mes, setMes] = useState(mesActualISO());
  const [tab, setTab] = useState<'ver' | 'roster'>('ver');
  const [descargando, setDescargando] = useState(false);

  // ── Datos de composición (vista + PDF) ──
  const { data: comp, isLoading } = useQuery({
    queryKey: ['composicion', mes],
    queryFn: () => composicionSedeApi.composicion(mes),
    enabled: puedeGestionar,
  });

  // ── Datos del roster (gestión) ──
  const { data: sedes = [] } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar, enabled: puedeGestionar });
  const { data: doctores = [] } = useQuery({ queryKey: ['comp-doctores'], queryFn: composicionSedeApi.doctores, enabled: puedeGestionar });
  const { data: recepcionistas = [] } = useQuery({ queryKey: ['comp-recepcionistas'], queryFn: composicionSedeApi.recepcionistas, enabled: puedeGestionar });
  const { data: asignaciones = [] } = useQuery({ queryKey: ['comp-asignaciones', mes], queryFn: () => composicionSedeApi.asignaciones(mes), enabled: puedeGestionar });

  const invalidarTodo = () => {
    qc.invalidateQueries({ queryKey: ['composicion'] });
    qc.invalidateQueries({ queryKey: ['comp-asignaciones'] });
    qc.invalidateQueries({ queryKey: ['comp-recepcionistas'] });
  };

  // ── Crear recepcionista ──
  const [nuevoNombre, setNuevoNombre] = useState('');
  const crearRecMut = useMutation({
    mutationFn: () => composicionSedeApi.crearRecepcionista(nuevoNombre.trim()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['comp-recepcionistas'] }); setNuevoNombre(''); toast.success('Recepcionista creada'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const eliminarRecMut = useMutation({
    mutationFn: (id: string) => composicionSedeApi.eliminarRecepcionista(id),
    onSuccess: () => { invalidarTodo(); toast.success('Recepcionista eliminada'); },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Asignar a sede ──
  const { inicio: mesIni, fin: mesFin } = rangoMesISO(mes);
  const [cargo, setCargo] = useState<'doctor' | 'recepcionista'>('doctor');
  const [personaId, setPersonaId] = useState('');
  const [sedeAsig, setSedeAsig] = useState('');
  const [desde, setDesde] = useState(mesIni);
  const [hasta, setHasta] = useState('');
  const [notas, setNotas] = useState('');

  const opciones = cargo === 'doctor'
    ? doctores.map(d => ({ id: d.id, nombre: d.nombre }))
    : recepcionistas.filter(r => r.activo).map(r => ({ id: r.id, nombre: r.nombre }));

  const crearAsigMut = useMutation({
    mutationFn: () => composicionSedeApi.crearAsignacion({
      sedeId: sedeAsig,
      fechaInicio: desde,
      fechaFin: hasta || null,
      profesionalId: cargo === 'doctor' ? personaId : null,
      recepcionistaId: cargo === 'recepcionista' ? personaId : null,
      notas: notas.trim() || undefined,
    }),
    onSuccess: () => { invalidarTodo(); setPersonaId(''); setNotas(''); setHasta(''); toast.success('Asignación creada'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const eliminarAsigMut = useMutation({
    mutationFn: (id: string) => composicionSedeApi.eliminarAsignacion(id),
    onSuccess: () => { invalidarTodo(); toast.success('Asignación eliminada'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const asignacionValida = !!sedeAsig && !!personaId && !!desde && (!hasta || hasta >= desde);

  const descargarPdf = async () => {
    setDescargando(true);
    try { await composicionSedeApi.descargarPDF(mes); toast.success('PDF descargado'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Error al generar el PDF'); }
    finally { setDescargando(false); }
  };

  const totalPersonas = useMemo(
    () => (comp?.sedes ?? []).reduce((s, x) => s + x.podologas.length + x.fisioterapeutas.length + x.doctores.length + x.recepcionistas.length, 0),
    [comp],
  );

  if (!puedeGestionar) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50 text-slate-400 text-sm">
        Solo la Coordinadora de Sedes (y el admin) pueden ver la composición de sedes.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50" data-testid="composicion-sede-page">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/herramientas')} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-all" title="Volver a Herramientas">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center shrink-0"><span className="text-white text-lg">🏢</span></div>
        <div className="flex-1">
          <h1 className="text-base font-bold text-slate-900">Composición de sedes</h1>
          <p className="text-xs text-slate-500">Quiénes componen cada sede en el mes — podólogas, fisios, doctores y recepcionistas</p>
        </div>
        {/* Mes + PDF */}
        <input type="month" value={mes} onChange={e => e.target.value && setMes(e.target.value)} className="input text-sm" data-testid="comp-mes-input" />
        <button onClick={descargarPdf} disabled={descargando || !comp}
          className="px-3 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 transition-colors whitespace-nowrap"
          data-testid="comp-btn-pdf">
          {descargando ? 'Generando…' : '📄 PDF'}
        </button>
      </div>

      {/* Sub-tabs */}
      <div className="bg-white border-b border-slate-200 px-6 flex gap-0">
        {([{ id: 'ver', label: 'Composición' }, { id: 'roster', label: 'Roster (doctores y recepcionistas)' }] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            data-testid={`comp-tab-${t.id}`}
            className={cn('px-4 py-2.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap',
              tab === t.id ? 'border-indigo-500 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300')}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {tab === 'ver' ? (
          isLoading ? (
            <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" /></div>
          ) : (
            <>
              <p className="text-xs text-slate-500 mb-4">
                <b className="text-slate-700 capitalize">{comp?.mesLabel}</b> · {comp?.inicio} a {comp?.fin} · {totalPersonas} persona(s) en {comp?.sedes.length} sede(s).
                <span className="text-slate-400"> Podólogas y fisios provienen de Movimientos; doctores y recepcionistas del roster de esta herramienta.</span>
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                {(comp?.sedes ?? []).map((s: SedeComposicion) => (
                  <div key={s.sedeId} className="bg-white border border-slate-200 rounded-xl overflow-hidden" data-testid={`comp-sede-${s.sedeId}`}>
                    <div className="bg-indigo-600 px-4 py-2.5"><h3 className="text-sm font-bold text-white">{s.nombre}</h3></div>
                    <div className="p-4 space-y-3.5">
                      <GrupoPersonas titulo="Podólogas" personas={s.podologas} color="text-slate-600" />
                      <GrupoPersonas titulo="Fisioterapeutas" personas={s.fisioterapeutas} color="text-cyan-700" />
                      <GrupoPersonas titulo="Doctores (baro)" personas={s.doctores} color="text-teal-700" />
                      <GrupoPersonas titulo="Recepcionistas" personas={s.recepcionistas} color="text-indigo-700" />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )
        ) : (
          <div className="space-y-6">
            {/* ── Recepcionistas (ficha de personal sin login) ── */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div>
                <p className="text-sm font-bold text-slate-900">Recepcionistas</p>
                <p className="text-xs text-slate-500">Fichas de personal (sin cuenta de acceso). Crea aquí a las recepcionistas para luego asignarlas a una sede.</p>
              </div>
              <div className="flex gap-2">
                <input type="text" value={nuevoNombre} onChange={e => setNuevoNombre(e.target.value)} placeholder="Nombre de la recepcionista"
                  className="input flex-1 text-sm" maxLength={120} data-testid="rec-nombre-input"
                  onKeyDown={e => { if (e.key === 'Enter' && nuevoNombre.trim().length >= 2) crearRecMut.mutate(); }} />
                <button onClick={() => crearRecMut.mutate()} disabled={nuevoNombre.trim().length < 2 || crearRecMut.isPending}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40"
                  data-testid="rec-crear-btn">Crear</button>
              </div>
              {recepcionistas.length === 0 ? (
                <p className="text-xs text-slate-400 italic">Aún no hay recepcionistas.</p>
              ) : (
                <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
                  {recepcionistas.map(r => (
                    <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className={cn('flex-1 truncate', r.activo ? 'text-slate-700' : 'text-slate-400 line-through')}>{r.nombre}</span>
                      <button onClick={() => eliminarRecMut.mutate(r.id)} disabled={eliminarRecMut.isPending}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-all" title="Eliminar recepcionista">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* ── Asignar a una sede ── */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <p className="text-sm font-bold text-slate-900">Asignar a una sede</p>
              <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5 w-max">
                {(['doctor', 'recepcionista'] as const).map(c => (
                  <button key={c} onClick={() => { setCargo(c); setPersonaId(''); }}
                    className={cn('py-1.5 px-3 rounded-md text-xs font-semibold capitalize transition-all', cargo === c ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
                    {c === 'doctor' ? '🩺 Doctor' : '💁 Recepcionista'}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">{cargo === 'doctor' ? 'Doctor' : 'Recepcionista'}</label>
                  <select value={personaId} onChange={e => setPersonaId(e.target.value)} className="input w-full text-sm" data-testid="asig-persona-select">
                    <option value="">— elegir —</option>
                    {opciones.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                  </select>
                  {opciones.length === 0 && <p className="mt-1 text-xxs text-amber-600">{cargo === 'doctor' ? 'No hay doctores (créalos en Admin → Profesionales como tipo Médico).' : 'Crea una recepcionista arriba primero.'}</p>}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Sede</label>
                  <select value={sedeAsig} onChange={e => setSedeAsig(e.target.value)} className="input w-full text-sm" data-testid="asig-sede-select">
                    <option value="">— elegir —</option>
                    {sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Desde</label>
                  <input type="date" value={desde} onChange={e => e.target.value && setDesde(e.target.value)} className="input w-full text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Hasta <span className="font-normal text-slate-400">(vacío = indefinido)</span></label>
                  <input type="date" value={hasta} min={desde} onChange={e => setHasta(e.target.value)} className="input w-full text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Notas <span className="font-normal text-slate-400">(opcional)</span></label>
                <input type="text" value={notas} onChange={e => setNotas(e.target.value)} placeholder="Motivo, referencia…" className="input w-full text-sm" maxLength={300} />
              </div>
              <button onClick={() => crearAsigMut.mutate()} disabled={!asignacionValida || crearAsigMut.isPending}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                data-testid="asig-submit">
                {crearAsigMut.isPending ? 'Asignando…' : '➕ Asignar a la sede'}
              </button>
            </div>

            {/* ── Asignaciones vigentes en el mes ── */}
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest px-1">Asignaciones del mes ({asignaciones.length})</p>
              {asignaciones.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">Sin asignaciones de doctores/recepcionistas este mes.</p>
              ) : (
                <ul className="space-y-1.5">
                  {asignaciones.map(a => (
                    <li key={a.id} className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-2.5">
                      <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0', a.cargo === 'doctor' ? 'bg-teal-100 text-teal-700' : 'bg-indigo-100 text-indigo-700')}>
                        {a.cargo === 'doctor' ? '🩺 Doctor' : '💁 Recep.'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{a.personaNombre} <span className="font-normal text-slate-400">· {a.sedeNombre}</span></p>
                        <p className="text-xs text-slate-500">{a.fechaInicio} {a.fechaFin ? `– ${a.fechaFin}` : '– indefinido'}{a.notas ? ` · ${a.notas}` : ''}</p>
                      </div>
                      <button onClick={() => eliminarAsigMut.mutate(a.id)} disabled={eliminarAsigMut.isPending}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all" title="Eliminar asignación">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
