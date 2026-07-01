import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { recordatoriosApi, type FiltroRecordatorios, type RecordatorioDia } from '../../api/recordatorios';
import { sedesApi, type Sede } from '../../api';
import { useAuthStore } from '../../stores/authStore';

const ESTADO_BADGE: Record<string, string> = {
  PROGRAMADO: 'bg-slate-100 text-slate-600 border-slate-200',
  ENVIADO: 'bg-blue-100 text-blue-700 border-blue-200',
  FALLIDO: 'bg-red-100 text-red-700 border-red-200',
  CANCELADO: 'bg-amber-100 text-amber-700 border-amber-200',
};

function hhmm(iso: string | null): string {
  return iso ? format(new Date(iso), 'HH:mm') : '—';
}

// Etiqueta de respuesta del paciente para una fila.
function respuesta(r: RecordatorioDia): { txt: string; cls: string } {
  if (r.confirmadoAt || r.clickConfirmarAt) return { txt: '✓ Confirmó', cls: 'text-green-700 font-semibold' };
  if (r.clickReprogramarAt) return { txt: '↻ Pidió reprogramar', cls: 'text-teal-700 font-semibold' };
  if (r.estadoRecordatorio === 'ENVIADO') return { txt: 'Sin respuesta', cls: 'text-slate-400' };
  return { txt: '—', cls: 'text-slate-300' };
}

export function RecordatoriosPanel() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tiene = useAuthStore(s => s.tiene);
  const puedeReenviar = tiene('herramientas.estrategicas') || useAuthStore.getState().usuario?.rol === 'admin';

  const hoy = format(new Date(), 'yyyy-MM-dd');
  const [modoRango, setModoRango] = useState(false);
  const [fecha, setFecha] = useState(hoy);
  const [fechaDesde, setFechaDesde] = useState(hoy);
  const [fechaHasta, setFechaHasta] = useState(hoy);
  const [sedeId, setSedeId] = useState('');
  const [estado, setEstado] = useState('');

  const filtro: FiltroRecordatorios = modoRango
    ? { fechaDesde, fechaHasta, sedeId, estado }
    : { fecha, sedeId, estado };

  const { data: sedes = [] } = useQuery<Sede[]>({ queryKey: ['sedes-rec'], queryFn: () => sedesApi.listar(), staleTime: 300_000 });
  const { data: metricas } = useQuery({ queryKey: ['rec-metricas', filtro], queryFn: () => recordatoriosApi.metricas(filtro) });
  const { data: filas = [], isLoading } = useQuery({ queryKey: ['rec-dia', filtro], queryFn: () => recordatoriosApi.dia(filtro) });

  const reenviar = useMutation({
    mutationFn: (citaId: string) => recordatoriosApi.reenviar(citaId),
    onSuccess: () => { toast.success('Recordatorio reencolado'); qc.invalidateQueries({ queryKey: ['rec-dia'] }); qc.invalidateQueries({ queryKey: ['rec-metricas'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const Card = ({ label, value, sub, tone = 'slate' }: { label: string; value: string | number; sub?: string; tone?: string }) => (
    <div className={`rounded-xl border p-3 bg-${tone}-50 border-${tone}-100`}>
      <p className="text-xxs uppercase tracking-wide text-slate-500 font-semibold">{label}</p>
      <p className="text-xl font-bold text-slate-900 leading-tight mt-0.5">{value}</p>
      {sub && <p className="text-xxs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3">
        <button onClick={() => navigate('/herramientas')} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100" title="Volver">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="w-9 h-9 rounded-xl bg-sky-600 flex items-center justify-center">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
        </div>
        <div>
          <h1 className="text-base font-bold text-slate-900">Recordatorios de Cita por Correo</h1>
          <p className="text-xs text-slate-500">Estado de envíos y respuestas — sin tracking de apertura</p>
        </div>
      </div>

      <div className="p-6 space-y-5 max-w-6xl">
        {/* Filtros */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xxs font-semibold text-slate-500 uppercase mb-1">Período</label>
            <div className="flex gap-1">
              <button onClick={() => setModoRango(false)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${!modoRango ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200'}`}>Día</button>
              <button onClick={() => setModoRango(true)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${modoRango ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200'}`}>Rango</button>
            </div>
          </div>
          {!modoRango ? (
            <div>
              <label className="block text-xxs font-semibold text-slate-500 uppercase mb-1">Fecha</label>
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className="input text-sm" />
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <div><label className="block text-xxs font-semibold text-slate-500 uppercase mb-1">Desde</label><input type="date" value={fechaDesde} max={fechaHasta} onChange={e => setFechaDesde(e.target.value)} className="input text-sm" /></div>
              <div><label className="block text-xxs font-semibold text-slate-500 uppercase mb-1">Hasta</label><input type="date" value={fechaHasta} min={fechaDesde} onChange={e => setFechaHasta(e.target.value)} className="input text-sm" /></div>
            </div>
          )}
          <div>
            <label className="block text-xxs font-semibold text-slate-500 uppercase mb-1">Sede</label>
            <select value={sedeId} onChange={e => setSedeId(e.target.value)} className="input text-sm"><option value="">Todas</option>{sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select>
          </div>
          <div>
            <label className="block text-xxs font-semibold text-slate-500 uppercase mb-1">Estado</label>
            <select value={estado} onChange={e => setEstado(e.target.value)} className="input text-sm">
              <option value="">Todos</option><option value="PROGRAMADO">Programado</option><option value="ENVIADO">Enviado</option><option value="FALLIDO">Fallido</option><option value="CANCELADO">Cancelado</option>
            </select>
          </div>
        </div>

        {/* Métricas */}
        {metricas && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              <Card label="Enviados" value={metricas.enviados} sub={`de ${metricas.total} programados`} />
              <Card label="Pendientes" value={metricas.programados} />
              <Card label="Fallidos" value={metricas.fallidos} />
              <Card label="Tasa de envío" value={`${metricas.tasaEnvioExitoso}%`} />
              <Card label="Tasa de respuesta" value={`${metricas.tasaRespuesta}%`} sub={`${metricas.conClic} con clic`} />
              <Card label="Confirmación efectiva" value={`${metricas.tasaConfirmacionEfectiva}%`} sub={`${metricas.confirmados} confirmados`} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card label="Confirmados" value={`${metricas.confirmados}`} sub={`${metricas.pctConfirmados}% de enviados`} />
              <Card label="Pidió reprogramar" value={`${metricas.pidioReprogramar}`} sub={`${metricas.pctPidioReprogramar}% de enviados`} />
              <Card label="Sin respuesta" value={`${metricas.sinRespuesta}`} sub="posible no-show" />
              <Card label="T. prom. confirmación" value={metricas.tiempoPromedioConfirmacionMin != null ? `${metricas.tiempoPromedioConfirmacionMin} min` : '—'} />
              <Card label="Cuota Gmail hoy" value={`${metricas.cuotaUsadaHoy}/${metricas.cuotaLimiteDiario}`} sub="envíos del día" />
            </div>
            {metricas.porSede.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <p className="text-xs font-semibold text-slate-600 uppercase mb-2">Confirmación por sede</p>
                <div className="flex flex-wrap gap-3">
                  {metricas.porSede.map(s => (
                    <div key={s.sede} className="text-sm"><span className="font-semibold text-slate-800">{s.sede}:</span> <span className="text-sky-700 font-bold">{s.tasaConfirmacion}%</span> <span className="text-slate-400 text-xs">({s.confirmados}/{s.enviados})</span></div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Tabla por día */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 text-xs font-semibold text-slate-600 uppercase">Detalle de envíos {!modoRango && `· ${fecha.split('-').reverse().join('/')}`}</div>
          {isLoading ? (
            <div className="p-8 text-center text-slate-400 text-sm">Cargando…</div>
          ) : filas.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">No hay recordatorios para este filtro.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xxs uppercase text-slate-400 border-b border-slate-100">
                  <th className="px-3 py-2">Hora</th><th className="px-3 py-2">Paciente</th><th className="px-3 py-2">Sede</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2">Respuesta</th><th className="px-3 py-2">Programado</th><th className="px-3 py-2"></th>
                </tr></thead>
                <tbody>
                  {filas.map(r => {
                    const resp = respuesta(r);
                    return (
                      <tr key={r.recordatorioId} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-700">{r.hora}</td>
                        <td className="px-3 py-2"><div className="text-slate-800">{r.paciente}</div><div className="text-xxs text-slate-400">{r.email ?? 'sin correo'}</div></td>
                        <td className="px-3 py-2 text-slate-600">{r.sede}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xxs font-semibold border ${ESTADO_BADGE[r.estadoRecordatorio]}`}>{r.estadoRecordatorio}</span>
                          {r.estadoRecordatorio === 'FALLIDO' && r.errorMensaje && <div className="text-xxs text-red-500 mt-0.5 max-w-[180px] truncate" title={r.errorMensaje}>{r.errorMensaje}</div>}
                        </td>
                        <td className={`px-3 py-2 text-xs ${resp.cls}`}>{resp.txt}</td>
                        <td className="px-3 py-2 text-slate-500 text-xs">{hhmm(r.programadoPara)}{r.intentos > 0 && <span className="text-slate-300"> · {r.intentos}int</span>}</td>
                        <td className="px-3 py-2 text-right">
                          {puedeReenviar && (
                            <button onClick={() => reenviar.mutate(r.citaId)} disabled={reenviar.isPending} className="text-xs font-semibold text-sky-600 hover:text-sky-800 disabled:opacity-50">Reenviar</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
