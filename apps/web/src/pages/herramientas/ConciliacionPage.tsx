// Pantalla de CONCILIACIÓN de aperturas Genexis (solo admin/dirección).
// El motor propone; aquí se firma: Aprobar / Editar-y-aprobar / Descartar.
// El panel de evidencia muestra las citas del historial Genexis que sustentan
// las lecturas A (nombres) y B (observaciones).

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { api } from '../../api/client';
import { Skeleton } from '../../components/ui/Skeleton';
import { cn } from '../../utils/cn';

interface FilaConciliacion {
  id: string;
  paciente: { id: string; nombres: string; apellidoPaterno: string; apellidoMaterno: string; tipoDocumento: string; numeroDocumento: string };
  familia: { id: string; nombreFamilia: string; tipo: string; sesionesTotales: number | null; duracionMeses: number | null };
  lecturaServicio: number | null;
  lecturaObs: number | null;
  consumoPropuesto: number | null;
  consumoAprobado: number | null;
  ajusteProCliente: boolean;
  confianza: 'VERDE' | 'AMBAR' | 'ROJO';
  sedeInferidaId: string | null;
  sedeAprobadaId: string | null;
  servicioResueltoId: string | null;
  vigenciaFinEstimada: string | null;
  flagVigencia: boolean;
  estado: string;
  notas: string | null;
  decididoPor: string | null;
}

interface RespuestaLista {
  data: FilaConciliacion[];
  total: number;
  page: number;
  limit: number;
  contadores: { porEstado: Record<string, number>; pendientesPorConfianza: Record<string, number> };
  catalogos: {
    familias: { id: string; nombreFamilia: string; tipo: string }[];
    sedes: { id: string; nombre: string; color: string }[];
    servicios: { id: string; nombre: string; codigo: string }[];
  };
}

interface EvidenciaRegistro {
  id: string; fechaCita: string; horaCita: string | null; sede: string | null; servicio: string | null;
  obsPaciente: string | null; obsPodologo: string | null; llegoPaciente: string | null;
}

const BADGE_CONFIANZA: Record<string, string> = {
  VERDE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  AMBAR: 'bg-amber-50 text-amber-700 border-amber-300',
  ROJO: 'bg-red-50 text-red-600 border-red-200',
};

export function ConciliacionPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [estado, setEstado] = useState('PENDIENTE');
  const [confianza, setConfianza] = useState('');
  const [familiaId, setFamiliaId] = useState('');
  const [sedeId, setSedeId] = useState('');
  const [page, setPage] = useState(1);
  const [abierta, setAbierta] = useState<string | null>(null);

  const params: Record<string, string> = { page: String(page), limit: '50' };
  if (estado) params.estado = estado;
  if (confianza) params.confianza = confianza;
  if (familiaId) params.familiaId = familiaId;
  if (sedeId) params.sedeId = sedeId;

  const { data, isLoading } = useQuery({
    queryKey: ['conciliacion-aperturas', params],
    queryFn: () => api.get<RespuestaLista>('/conciliacion/aperturas', params),
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ['conciliacion-aperturas'] });

  const aprobarMutation = useMutation({
    mutationFn: (vars: { id: string; consumo?: number; sedeId?: string; vigenciaFin?: string }) =>
      api.post(`/conciliacion/aperturas/${vars.id}/aprobar`, vars),
    onSuccess: () => { invalidar(); toast.success('Apertura aprobada — paquete activo'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const descartarMutation = useMutation({
    mutationFn: (vars: { id: string; motivo: string }) => api.post(`/conciliacion/aperturas/${vars.id}/descartar`, { motivo: vars.motivo }),
    onSuccess: () => { invalidar(); toast.success('Propuesta descartada'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const bloqueMutation = useMutation({
    mutationFn: (confianza: 'VERDE' | 'AMBAR') =>
      api.post<{ aprobadas: number; fallidas: number; motivos: Record<string, number> }>('/conciliacion/aperturas/aprobar-bloque', { confianza }),
    onSuccess: (r) => {
      invalidar();
      const detalleFallos = r.fallidas > 0
        ? ` · ${r.fallidas} quedaron pendientes (${Object.entries(r.motivos).map(([m, n]) => `${n}: ${m}`).join('; ')})`
        : '';
      toast.success(`${r.aprobadas} aperturas aprobadas en bloque${detalleFallos}`, { duration: r.fallidas > 0 ? 8000 : 4000 });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const cerrarMutation = useMutation({
    mutationFn: (confirmar: boolean) => api.post('/conciliacion/cerrar', { confirmarPendientes: confirmar }),
    onSuccess: () => toast.success('Proceso de conciliación sellado en AuditLog'),
    onError: (e: Error) => {
      if (e.message.includes('pendientes')) {
        if (window.confirm(e.message + '\n¿Cerrar de todas formas?')) cerrarMutation.mutate(true);
      } else toast.error(e.message);
    },
  });

  const cont = data?.contadores;
  const sedes = data?.catalogos.sedes ?? [];
  const servicios = data?.catalogos.servicios ?? [];
  const nombreSede = (id: string | null) => sedes.find((s) => s.id === id)?.nombre ?? '—';
  const nombreServicio = (id: string | null) => servicios.find((s) => s.id === id)?.nombre ?? 'SIN EQUIVALENTE';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-lg font-bold text-slate-900">Conciliación de saldos Genexis</h1>
          <span className="text-xs text-slate-400">el motor propone · una persona firma</span>
          <div className="flex-1" />
          <button
            onClick={() => { if (window.confirm('¿Aprobar TODAS las propuestas VERDES pendientes?')) bloqueMutation.mutate('VERDE'); }}
            disabled={bloqueMutation.isPending}
            className="btn-primary btn-sm"
          >
            {bloqueMutation.isPending ? 'Aprobando…' : `✓ Aprobar VERDES en bloque (${cont?.pendientesPorConfianza.VERDE ?? 0})`}
          </button>
          <button
            onClick={() => { if (window.confirm('¿Aprobar TODAS las ÁMBAR pendientes con la propuesta pro-cliente (máx − 1)?\n\nEsto acepta el cálculo del motor sin revisar cada una. Las rojas NO se tocan.')) bloqueMutation.mutate('AMBAR'); }}
            disabled={bloqueMutation.isPending}
            className="btn-sm rounded-lg px-3 font-semibold text-amber-700 bg-amber-50 border border-amber-300 hover:bg-amber-100 disabled:opacity-50"
            title="Acepta el consumo propuesto (pro-cliente máx−1) de todas las ámbar. Las que falten sede/vigencia quedan pendientes."
          >
            {bloqueMutation.isPending ? 'Aprobando…' : `✓ Aprobar ÁMBAR en bloque (${cont?.pendientesPorConfianza.AMBAR ?? 0})`}
          </button>
          <button onClick={() => cerrarMutation.mutate(false)} className="btn-secondary btn-sm">🔒 Cerrar proceso</button>
        </div>
        {/* Contadores de avance */}
        <div className="mt-2 flex items-center gap-2 text-xs flex-wrap">
          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold">Pendientes: {cont?.porEstado.PENDIENTE ?? 0}</span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">V {cont?.pendientesPorConfianza.VERDE ?? 0}</span>
          <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-300">A {cont?.pendientesPorConfianza.AMBAR ?? 0}</span>
          <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">R {cont?.pendientesPorConfianza.ROJO ?? 0}</span>
          <span className="text-slate-300">·</span>
          <span className="text-slate-500">Aprobadas: {(cont?.porEstado.APROBADA ?? 0) + (cont?.porEstado.EDITADA ?? 0)}</span>
          <span className="text-slate-500">Descartadas: {cont?.porEstado.DESCARTADA ?? 0}</span>
        </div>
        {/* Filtros */}
        <div className="mt-2 flex gap-2 flex-wrap">
          <select className="input text-xs w-auto" value={estado} onChange={(e) => { setEstado(e.target.value); setPage(1); }}>
            <option value="PENDIENTE">Pendientes</option>
            <option value="APROBADA">Aprobadas</option>
            <option value="EDITADA">Editadas</option>
            <option value="DESCARTADA">Descartadas</option>
            <option value="">Todas</option>
          </select>
          <select className="input text-xs w-auto" value={confianza} onChange={(e) => { setConfianza(e.target.value); setPage(1); }}>
            <option value="">Toda confianza</option>
            <option value="VERDE">Verde</option>
            <option value="AMBAR">Ámbar</option>
            <option value="ROJO">Rojo</option>
          </select>
          <select className="input text-xs w-auto max-w-[220px]" value={familiaId} onChange={(e) => { setFamiliaId(e.target.value); setPage(1); }}>
            <option value="">Todas las familias</option>
            {data?.catalogos.familias.map((f) => <option key={f.id} value={f.id}>{f.nombreFamilia}</option>)}
          </select>
          <select className="input text-xs w-auto" value={sedeId} onChange={(e) => { setSedeId(e.target.value); setPage(1); }}>
            <option value="">Todas las sedes</option>
            {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading && <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>}
        {data && data.data.length === 0 && <p className="text-center text-slate-400 py-12 text-sm">Sin propuestas para los filtros</p>}
        <div className="space-y-2">
          {data?.data.map((f) => (
            <FilaPropuesta
              key={f.id}
              fila={f}
              abierta={abierta === f.id}
              onToggle={() => setAbierta(abierta === f.id ? null : f.id)}
              nombreSede={nombreSede}
              nombreServicio={nombreServicio}
              sedes={sedes}
              onAprobar={(vars) => aprobarMutation.mutate({ id: f.id, ...vars })}
              onDescartar={(motivo) => descartarMutation.mutate({ id: f.id, motivo })}
              onVerPaciente={() => navigate(`/pacientes/${f.paciente.id}`)}
            />
          ))}
        </div>
        {data && data.total > data.limit && (
          <div className="flex items-center justify-center gap-3 mt-4 text-xs">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="btn-secondary btn-sm disabled:opacity-40">‹ Anterior</button>
            <span className="text-slate-500">Página {page} de {Math.ceil(data.total / data.limit)}</span>
            <button disabled={page * data.limit >= data.total} onClick={() => setPage((p) => p + 1)} className="btn-secondary btn-sm disabled:opacity-40">Siguiente ›</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Fila con panel de evidencia + acciones ───────────────────────────────────

function FilaPropuesta({ fila: f, abierta, onToggle, nombreSede, nombreServicio, sedes, onAprobar, onDescartar, onVerPaciente }: {
  fila: FilaConciliacion;
  abierta: boolean;
  onToggle: () => void;
  nombreSede: (id: string | null) => string;
  nombreServicio: (id: string | null) => string;
  sedes: { id: string; nombre: string }[];
  onAprobar: (vars: { consumo?: number; sedeId?: string; vigenciaFin?: string }) => void;
  onDescartar: (motivo: string) => void;
  onVerPaciente: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [consumoEdit, setConsumoEdit] = useState(f.consumoPropuesto ?? 0);
  const [sedeEdit, setSedeEdit] = useState(f.sedeInferidaId ?? '');
  const [vigenciaEdit, setVigenciaEdit] = useState(f.vigenciaFinEstimada ?? '');
  const { data: evidencia } = useQuery({
    queryKey: ['conciliacion-evidencia', f.id],
    queryFn: () => api.get<{ data: EvidenciaRegistro[] }>(`/conciliacion/aperturas/${f.id}/evidencia`),
    enabled: abierta,
  });
  const total = f.familia.sesionesTotales ?? 0;
  const saldo = f.consumoPropuesto !== null ? total - f.consumoPropuesto : null;
  const esPendiente = f.estado === 'PENDIENTE';

  return (
    <div className="bg-white rounded-xl border border-slate-200">
      <button onClick={onToggle} className="w-full text-left px-4 py-2.5 flex items-center gap-3 flex-wrap hover:bg-slate-50 rounded-xl">
        <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full border shrink-0', BADGE_CONFIANZA[f.confianza])}>{f.confianza}</span>
        <span className="text-sm font-semibold text-slate-800 truncate">
          {f.paciente.nombres} {f.paciente.apellidoPaterno} <span className="text-slate-400 font-normal">({f.paciente.numeroDocumento})</span>
        </span>
        <span className="text-xs text-slate-500 truncate">{f.familia.nombreFamilia} → {nombreServicio(f.servicioResueltoId)}</span>
        <span className="text-xs text-slate-400">{nombreSede(f.sedeAprobadaId ?? f.sedeInferidaId)}</span>
        <span className="ml-auto text-xs font-mono text-slate-600 shrink-0">
          A:{f.lecturaServicio ?? '—'} B:{f.lecturaObs ?? '—'} →{' '}
          <b>{f.consumoPropuesto !== null ? `${f.consumoPropuesto}/${total}` : '¿?'}</b>
          {saldo !== null && <span className="text-emerald-600"> · saldo {saldo}</span>}
        </span>
        {f.ajusteProCliente && <span className="text-[9px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1 shrink-0">PRO-CLIENTE</span>}
        {f.flagVigencia && <span className="text-[9px] font-bold text-red-500 bg-red-50 border border-red-200 rounded px-1 shrink-0">VIGENCIA</span>}
        {!esPendiente && <span className="text-[10px] text-slate-400 shrink-0">{f.estado} por {f.decididoPor}</span>}
      </button>

      {abierta && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-3">
          {f.notas && <p className="text-xs text-amber-700">⚠ {f.notas}</p>}
          {/* Panel de evidencia (historial Genexis crudo, solo lectura) */}
          <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
            {(evidencia?.data ?? []).map((r) => (
              <div key={r.id} className={cn('text-xs px-2 py-1.5 rounded-md border', r.llegoPaciente === 'Sí' ? 'bg-emerald-50/50 border-emerald-100' : 'bg-slate-50 border-slate-100 opacity-70')}>
                <span className="font-semibold text-slate-700">{format(new Date(r.fechaCita + 'T12:00:00'), 'd MMM yyyy', { locale: es })}</span>
                <span className="text-slate-400"> · {r.sede} · </span>
                <span className="text-slate-600">{r.servicio}</span>
                <span className={cn('ml-1 font-bold', r.llegoPaciente === 'Sí' ? 'text-emerald-600' : 'text-red-400')}>{r.llegoPaciente ?? 's/d'}</span>
                {(r.obsPaciente || r.obsPodologo) && (
                  <p className="text-slate-500 mt-0.5 italic">{[r.obsPaciente, r.obsPodologo].filter(Boolean).join(' · ')}</p>
                )}
              </div>
            ))}
          </div>

          {esPendiente && (
            <div className="flex items-end gap-2 flex-wrap">
              {editando && (
                <>
                  <label className="block text-xs text-slate-500">
                    Consumo
                    <input type="number" min={0} max={total} className="input text-sm w-20" value={consumoEdit} onChange={(e) => setConsumoEdit(Number(e.target.value))} />
                  </label>
                  <label className="block text-xs text-slate-500">
                    Sede
                    <select className="input text-sm w-36" value={sedeEdit} onChange={(e) => setSedeEdit(e.target.value)}>
                      <option value="">—</option>
                      {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                    </select>
                  </label>
                  {f.familia.tipo === 'MEMBRESIA' && (
                    <label className="block text-xs text-slate-500">
                      Vence
                      <input type="date" className="input text-sm" value={vigenciaEdit} onChange={(e) => setVigenciaEdit(e.target.value)} />
                    </label>
                  )}
                </>
              )}
              <button
                onClick={() =>
                  editando
                    ? onAprobar({ consumo: consumoEdit, sedeId: sedeEdit || undefined, vigenciaFin: vigenciaEdit || undefined })
                    : onAprobar({})
                }
                disabled={!editando && f.consumoPropuesto === null}
                className="btn-primary btn-sm disabled:opacity-40"
                title={f.consumoPropuesto === null ? 'ILEGIBLE: usa Editar para fijar el consumo' : ''}
              >
                ✓ {editando ? 'Aprobar editado' : 'Aprobar'}
              </button>
              {!editando && <button onClick={() => setEditando(true)} className="btn-secondary btn-sm">✎ Editar</button>}
              <button
                onClick={() => { const m = window.prompt('Motivo del descarte:'); if (m?.trim()) onDescartar(m.trim()); }}
                className="btn-sm text-red-500 border border-red-200 rounded-lg px-3 hover:bg-red-50"
              >
                ✕ Descartar
              </button>
              <button onClick={onVerPaciente} className="ml-auto text-xs text-limablue-600 hover:underline">Ver ficha →</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
