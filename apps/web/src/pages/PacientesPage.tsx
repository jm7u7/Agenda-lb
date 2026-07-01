import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { pacientesApi, paquetesApi } from '../api';
import { BadgeEstado } from '../components/ui/Badge';
import { RomboAlerta } from '../components/pacientes/RomboAlerta';
import { CuadroFamiliares } from '../components/pacientes/CuadroFamiliares';
import { Skeleton } from '../components/ui/Skeleton';
import { cn } from '../utils/cn';

// ─── Lista/búsqueda ───────────────────────────────────────────────────────────

export function PacientesPage() {
  const [q, setQ] = useState('');
  const navigate = useNavigate();

  const { data: resultados, isLoading } = useQuery({
    queryKey: ['pacientes-buscar', q],
    queryFn: () => pacientesApi.buscar(q),
    enabled: q.length >= 2,
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <h1 className="text-lg font-bold text-slate-900">Pacientes</h1>
        <div className="mt-3 max-w-lg">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              className="input pl-9"
              placeholder="Buscar por nombre, DNI o teléfono..."
              value={q}
              onChange={e => setQ(e.target.value)}
              autoFocus
            />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {q.length < 2 && (
          <div className="text-center py-16 text-slate-400">
            <p className="text-4xl mb-3">👤</p>
            <p className="text-sm">Escribe al menos 2 caracteres para buscar</p>
          </div>
        )}

        {isLoading && q.length >= 2 && (
          <div className="space-y-2">
            {[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        )}

        {resultados && resultados.length === 0 && q.length >= 2 && (
          <div className="text-center py-12 text-slate-400">
            <p className="text-sm">No se encontraron pacientes para "{q}"</p>
          </div>
        )}

        {resultados && resultados.length > 0 && (
          <div className="space-y-1">
            {resultados.map(p => (
              <button
                key={p.id}
                onClick={() => navigate(`/pacientes/${p.id}`)}
                className="w-full text-left bg-white rounded-lg border border-slate-200 px-4 py-3 hover:border-limablue-300 hover:bg-limablue-50 transition-all"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-900 flex items-center gap-1.5">
                      <RomboAlerta alerta={p.alerta} size={12} />
                      <span>{p.nombreCompleto}</span>
                    </p>
                    <p className="text-sm text-slate-500">
                      {p.tipoDocumento} {p.numeroDocumento} · {p.telefono}
                    </p>
                  </div>
                  <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Ficha de paciente ────────────────────────────────────────────────────────

// `fecha` viene como medianoche UTC ("2026-06-24T00:00:00.000Z"). `new Date()` directo
// la corre un día hacia atrás en zonas con offset negativo (Lima UTC-5). Anclamos al
// mediodía local sobre la parte de fecha para mostrar SIEMPRE el día correcto.
const parseFechaLocal = (f: string) => new Date(f.slice(0, 10) + 'T12:00:00');

export function FichaPacientePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [notas, setNotas] = useState('');

  const { data: paciente, isLoading } = useQuery({
    queryKey: ['paciente', id],
    queryFn: () => pacientesApi.obtener(id!),
    enabled: !!id,
  });

  const { data: paquetes } = useQuery({
    queryKey: ['paquetes-paciente', id],
    queryFn: () => paquetesApi.porPaciente(id!),
    enabled: !!id,
  });

  const actualizarMutation = useMutation({
    mutationFn: (data: { notas: string }) => pacientesApi.actualizar(id!, data as never),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['paciente', id] });
      toast.success('Notas actualizadas');
      setEditando(false);
    },
  });

  // ── Edición de los DATOS del paciente (fuente única: el registro Paciente; las
  //    citas lo referencian por FK, así que al guardar se refresca toda la agenda) ──
  const [editandoDatos, setEditandoDatos] = useState(false);
  const [form, setForm] = useState({
    nombres: '', apellidoPaterno: '', apellidoMaterno: '', tipoDocumento: 'DNI',
    numeroDocumento: '', telefono: '', email: '', fechaNacimiento: '', sexo: '',
  });

  const abrirEdicionDatos = () => {
    if (!paciente) return;
    setForm({
      nombres: paciente.nombres ?? '', apellidoPaterno: paciente.apellidoPaterno ?? '',
      apellidoMaterno: paciente.apellidoMaterno ?? '', tipoDocumento: paciente.tipoDocumento ?? 'DNI',
      numeroDocumento: paciente.numeroDocumento ?? '', telefono: paciente.telefono ?? '',
      email: paciente.email ?? '', fechaNacimiento: (paciente.fechaNacimiento ?? '').slice(0, 10), sexo: paciente.sexo ?? '',
    });
    setEditandoDatos(true);
  };

  const guardarDatosMutation = useMutation({
    mutationFn: () => pacientesApi.actualizar(id!, {
      nombres: form.nombres.trim(), apellidoPaterno: form.apellidoPaterno.trim(),
      apellidoMaterno: form.apellidoMaterno.trim(), tipoDocumento: form.tipoDocumento,
      numeroDocumento: form.numeroDocumento.trim(), telefono: form.telefono.trim(),
      email: form.email.trim() || undefined, fechaNacimiento: form.fechaNacimiento || undefined,
      sexo: form.sexo || undefined,
    } as never),
    onSuccess: () => {
      // Una sola fuente de verdad → refrescar TODO lo que muestra al paciente.
      qc.invalidateQueries({ queryKey: ['paciente', id] });
      qc.invalidateQueries({ queryKey: ['citas'] });
      qc.invalidateQueries({ queryKey: ['paciente-historial', id] });
      qc.invalidateQueries({ queryKey: ['pacientes-buscar'] });
      toast.success('Datos del paciente actualizados');
      setEditandoDatos(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!paciente) return <div className="p-6 text-slate-500">Paciente no encontrado</div>;

  const historial = (paciente as never as { historial: { id: string; fecha: string; horaInicio: string; estado: string; slotGrupoId: string | null; slotRol: 'PRINCIPAL' | 'SECUNDARIO' | null; consultorioNumero: number | null; servicio: { nombre: string; color: string }; profesional: { nombres: string; apellidos: string } | null; sede: { nombre: string }; comentarios: { id: string; texto: string }[] }[] }).historial ?? [];
  const proximas = (paciente as never as { proximas: { id: string; fecha: string; horaInicio: string; estado: string; servicio: { nombre: string }; profesional: { nombres: string; apellidos: string } | null; sede: { nombre: string } }[] }).proximas ?? [];
  // Total real de atenciones (sobre todas las citas, no acotado a las 200 mostradas).
  const totalAtenciones = (paciente as never as { totalCitas?: number }).totalCitas ?? historial.length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-4">
        <button onClick={() => navigate('/pacientes')} className="btn-ghost btn-sm">
          ← Volver
        </button>
        <div>
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <RomboAlerta alerta={paciente.alerta} size={15} />
            <span>{paciente.nombres} {paciente.apellidoPaterno} {paciente.apellidoMaterno}</span>
          </h1>
          {paciente.alerta?.alerta && (
            <p className="text-xs font-semibold text-amber-700 mt-0.5">
              {paciente.alerta.frecuenteInasistente && `⚠ No asiste con frecuencia (${paciente.alerta.noShows} inasistencias). `}
              {paciente.alerta.frecuenteReprogramador && `⚠ Reprograma con frecuencia (${paciente.alerta.reprogramaciones} veces).`}
            </p>
          )}
          <p className="text-sm text-slate-500">
            {paciente.tipoDocumento} {paciente.numeroDocumento} · {paciente.telefono}
            {paciente.email && ` · ${paciente.email}`}
          </p>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => {
            navigate('/');
            setTimeout(() => document.dispatchEvent(new CustomEvent('agenda:nueva-cita')), 100);
          }}
          className="btn-primary btn-sm"
        >
          + Agendar cita
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
          {/* Info + notas */}
          <div className="grid grid-cols-3 gap-6">
            <div className="col-span-2 bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-700">Datos del paciente</h2>
                {!editandoDatos && (
                  <button onClick={abrirEdicionDatos} className="text-xs text-limablue-600 hover:underline">
                    Editar
                  </button>
                )}
              </div>

              {editandoDatos ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <label className="block">
                      <span className="text-xs text-slate-400">Nombres *</span>
                      <input className="input text-sm" value={form.nombres} onChange={e => setForm(f => ({ ...f, nombres: e.target.value }))} />
                    </label>
                    <label className="block">
                      <span className="text-xs text-slate-400">Apellido paterno *</span>
                      <input className="input text-sm" value={form.apellidoPaterno} onChange={e => setForm(f => ({ ...f, apellidoPaterno: e.target.value }))} />
                    </label>
                    <label className="block">
                      <span className="text-xs text-slate-400">Apellido materno *</span>
                      <input className="input text-sm" value={form.apellidoMaterno} onChange={e => setForm(f => ({ ...f, apellidoMaterno: e.target.value }))} />
                    </label>
                    <label className="block">
                      <span className="text-xs text-slate-400">Tipo de documento</span>
                      <select className="input text-sm" value={form.tipoDocumento} onChange={e => setForm(f => ({ ...f, tipoDocumento: e.target.value }))}>
                        {['DNI', 'CE', 'PASAPORTE', 'RUC'].map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs text-slate-400">N° documento *</span>
                      <input className="input text-sm" value={form.numeroDocumento} onChange={e => setForm(f => ({ ...f, numeroDocumento: e.target.value }))} />
                    </label>
                    <label className="block">
                      <span className="text-xs text-slate-400">Teléfono *</span>
                      <input className="input text-sm" value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} />
                    </label>
                    <label className="block">
                      <span className="text-xs text-slate-400">Email</span>
                      <input type="email" className="input text-sm" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                    </label>
                    <label className="block">
                      <span className="text-xs text-slate-400">Fecha nac.</span>
                      <input type="date" className="input text-sm" value={form.fechaNacimiento} onChange={e => setForm(f => ({ ...f, fechaNacimiento: e.target.value }))} />
                    </label>
                    <label className="block">
                      <span className="text-xs text-slate-400">Sexo</span>
                      <select className="input text-sm" value={form.sexo} onChange={e => setForm(f => ({ ...f, sexo: e.target.value }))}>
                        <option value="">—</option>
                        <option value="masculino">Masculino</option>
                        <option value="femenino">Femenino</option>
                        <option value="otro">Otro</option>
                      </select>
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => guardarDatosMutation.mutate()}
                      disabled={guardarDatosMutation.isPending || !form.nombres.trim() || !form.apellidoPaterno.trim() || !form.numeroDocumento.trim() || !form.telefono.trim()}
                      className="btn-primary btn-sm disabled:opacity-50"
                    >
                      {guardarDatosMutation.isPending ? 'Guardando…' : 'Guardar'}
                    </button>
                    <button onClick={() => setEditandoDatos(false)} className="btn-secondary btn-sm">Cancelar</button>
                  </div>
                  <p className="text-[11px] text-slate-400">Al guardar, el cambio se refleja en toda la agenda (el paciente se guarda una sola vez).</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ['Nombres', `${paciente.nombres}`],
                    ['Apellido paterno', paciente.apellidoPaterno],
                    ['Apellido materno', paciente.apellidoMaterno],
                    ['Documento', `${paciente.tipoDocumento} ${paciente.numeroDocumento}`],
                    ['Teléfono', paciente.telefono],
                    ['Email', paciente.email ?? '—'],
                    ['Fecha nac.', paciente.fechaNacimiento ? format(new Date(paciente.fechaNacimiento as string), 'd/MM/yyyy') : '—'],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <p className="text-xs text-slate-400">{label}</p>
                      <p className="font-medium text-slate-800">{val}</p>
                    </div>
                  ))}
                </div>
              )}

              {paciente.familiares && paciente.familiares.length > 0 && (
                <div className="mt-4">
                  <CuadroFamiliares familiares={paciente.familiares} />
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-700">Notas generales</h2>
                {!editando && (
                  <button
                    onClick={() => { setNotas(paciente.notas ?? ''); setEditando(true); }}
                    className="text-xs text-limablue-600 hover:underline"
                  >
                    Editar
                  </button>
                )}
              </div>
              {editando ? (
                <div className="space-y-2">
                  <textarea
                    className="input text-sm resize-none w-full"
                    rows={4}
                    value={notas}
                    onChange={e => setNotas(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button onClick={() => actualizarMutation.mutate({ notas })} className="btn-primary btn-sm">
                      Guardar
                    </button>
                    <button onClick={() => setEditando(false)} className="btn-secondary btn-sm">
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-600">{paciente.notas || <span className="text-slate-400 italic">Sin notas</span>}</p>
              )}
            </div>
          </div>

          {/* Paquetes activos */}
          {paquetes && paquetes.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-3">Paquetes activos</h2>
              <div className="space-y-3">
                {paquetes.map(pp => {
                  const progreso = Math.round((pp.sesionesUsadas / pp.sesionesTotal) * 100);
                  return (
                    <div key={pp.id} className="flex items-center gap-4">
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-medium text-slate-800">{pp.paquete.nombre}</p>
                          <p className="text-sm font-bold text-limablue-700">
                            {pp.sesionesUsadas}/{pp.sesionesTotal} sesiones
                          </p>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-limablue-500 rounded-full transition-all"
                            style={{ width: `${progreso}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Próximas citas + Historial — lado a lado (2 columnas) para no scrollear de más */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            {/* Próximas citas (columna angosta) */}
            {proximas.length > 0 && (
              <div className="lg:col-span-1 bg-white rounded-xl border border-slate-200 p-5">
                <h2 className="text-sm font-semibold text-slate-700 mb-3">Próximas citas ({proximas.length})</h2>
                <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
                  {proximas.map(c => (
                    <div key={c.id} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
                      <div className="text-center min-w-[48px]">
                        <p className="text-xs text-slate-400">{format(parseFechaLocal(c.fecha), 'EEE', { locale: es })}</p>
                        <p className="text-sm font-bold text-slate-700">{format(parseFechaLocal(c.fecha), 'd MMM', { locale: es })}</p>
                        <p className="text-xs text-limablue-600 font-medium">{c.horaInicio}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{c.servicio.nombre}</p>
                        <p className="text-xs text-slate-500 truncate">
                          {c.profesional ? `${c.profesional.nombres} ${c.profesional.apellidos}` : 'Por asignar'} · {c.sede.nombre}
                        </p>
                      </div>
                      <BadgeEstado estado={c.estado as never} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Historial (columna ancha; ocupa todo si no hay próximas) */}
            <div className={cn('bg-white rounded-xl border border-slate-200 p-5', proximas.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3')}>
              <h2 className="text-sm font-semibold text-slate-700 mb-3">
                Historial de atenciones ({totalAtenciones})
                {totalAtenciones > historial.length && (
                  <span className="ml-1 font-normal text-slate-400">· mostrando las {historial.length} más recientes</span>
                )}
              </h2>
              {historial.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">Sin atenciones registradas</p>
              ) : (
                <div className="overflow-auto max-h-[28rem]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white z-10">
                      <tr className="text-xs text-slate-500 border-b border-slate-100">
                        <th className="pb-2 text-left font-semibold">Fecha</th>
                        <th className="pb-2 text-left font-semibold">Servicio</th>
                        <th className="pb-2 text-left font-semibold">Profesional</th>
                        <th className="pb-2 text-left font-semibold">Sede</th>
                        <th className="pb-2 text-left font-semibold">Consultorio</th>
                        <th className="pb-2 text-left font-semibold">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historial.map(c => (
                        <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className="py-2 text-slate-600 whitespace-nowrap">
                            {format(parseFechaLocal(c.fecha), 'd MMM yyyy', { locale: es })}
                            <span className="text-slate-400 ml-1">{c.horaInicio}</span>
                          </td>
                          <td className="py-2">
                            <span className="font-medium text-slate-800">{c.servicio.nombre}</span>
                            {c.slotGrupoId && (
                              <span
                                title={`Turno combinado · ${c.slotRol === 'PRINCIPAL' ? 'profilaxis (ancla)' : 'servicio extra'} — agendada junto a otra cita en la misma hora`}
                                className="ml-1.5 inline-flex items-center gap-0.5 px-1 py-0.5 bg-violet-100 text-violet-700 rounded text-[10px] font-semibold align-middle"
                              >
                                🔗 {c.slotRol === 'PRINCIPAL' ? 'Combo' : 'Combo·extra'}
                              </span>
                            )}
                          </td>
                          <td className="py-2 text-slate-600">
                            {c.profesional ? `${c.profesional.nombres} ${c.profesional.apellidos}` : '—'}
                          </td>
                          <td className="py-2 text-slate-600">{c.sede.nombre}</td>
                          <td className="py-2 text-slate-600">
                            {c.consultorioNumero != null
                              ? <span className="inline-flex items-center justify-center min-w-[22px] px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-700 font-semibold text-xs">{c.consultorioNumero}</span>
                              : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="py-2">
                            <BadgeEstado estado={c.estado as never} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
