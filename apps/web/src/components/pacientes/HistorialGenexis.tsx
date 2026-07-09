// Visor del historial Genexis (sistema anterior): registro CONGELADO, solo lectura.
// - `BotonHistorialGenexis` consulta /existe y NO se renderiza si el paciente no
//   tiene historia vieja; al clic abre el visor.
// - El visor es un modal con resumen, filtros de sede/año y línea de tiempo
//   agrupada por año. Cero acciones de edición/borrado por diseño.
// - sede/servicio/podólogo se muestran CRUDOS (texto del sistema viejo, no FKs).
//   El badge de sede usa el color de la sede REAL de la Agenda si el nombre
//   coincide; "San Isidro" (nombre antiguo) hereda el color de Paz Soldán,
//   manteniendo visible el texto crudo.

import { useMemo, useState, Fragment } from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { historialGenexisApi, sedesApi, type HistorialGenexisRegistro } from '../../api';
import { Skeleton } from '../ui/Skeleton';
import { cn } from '../../utils/cn';

// Nombres de sede del sistema viejo → sede real de la Agenda (SOLO para heredar
// el color del badge; el texto mostrado sigue siendo el crudo del archivo).
const ALIAS_SEDE_GENEXIS: Record<string, string> = {
  'San Isidro': 'Paz Soldán',
};

const LIMIT = 50;

// ─── Botón (se renderiza solo si hay historia) ────────────────────────────────

interface BotonProps {
  pacienteId: string;
  nombrePaciente: string;
  documento: string; // ej. "DNI 41749485"
}

export function BotonHistorialGenexis({ pacienteId, nombrePaciente, documento }: BotonProps) {
  const [abierto, setAbierto] = useState(false);
  const { data } = useQuery({
    queryKey: ['historial-genexis-existe', pacienteId],
    queryFn: () => historialGenexisApi.existe(pacienteId),
    staleTime: 5 * 60_000, // el historial es congelado: no cambia en la sesión
  });

  if (!data?.existe) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 hover:bg-slate-100 hover:border-slate-300 transition-colors"
        title="Historial del sistema anterior (Genexis) — solo lectura"
      >
        <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
        </svg>
        <span>Historial Genexis · {data.total}</span>
        <span className="font-normal text-slate-400 hidden sm:inline">Sistema anterior</span>
      </button>
      {abierto && (
        <VisorHistorialGenexis
          pacienteId={pacienteId}
          nombrePaciente={nombrePaciente}
          documento={documento}
          onClose={() => setAbierto(false)}
        />
      )}
    </>
  );
}

// ─── Visor (modal solo lectura) ───────────────────────────────────────────────

interface VisorProps extends BotonProps {
  onClose: () => void;
}

function colorAsistencia(pct: number | null): string {
  if (pct === null) return 'text-slate-500';
  if (pct >= 80) return 'text-emerald-600';
  if (pct >= 50) return 'text-amber-600';
  return 'text-red-600';
}

// "2024-03-12" → "12 mar 2024" (anclado a mediodía para no correr el día en UTC−5).
const fmtFecha = (f: string) => format(new Date(f + 'T12:00:00'), 'd MMM yyyy', { locale: es });

export function VisorHistorialGenexis({ pacienteId, nombrePaciente, documento, onClose }: VisorProps) {
  const [sede, setSede] = useState('');
  const [anio, setAnio] = useState('');

  // Colores reales de las sedes de la Agenda (para el badge del visor).
  const { data: sedesAgenda } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar, staleTime: 10 * 60_000 });
  const colorDeSede = (cruda: string | null): string | null => {
    if (!cruda) return null;
    const nombre = ALIAS_SEDE_GENEXIS[cruda] ?? cruda;
    return sedesAgenda?.find((s) => s.nombre === nombre)?.color ?? null;
  };

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['historial-genexis', pacienteId, sede, anio],
    queryFn: ({ pageParam }) =>
      historialGenexisApi.listar(pacienteId, { sede: sede || undefined, anio: anio || undefined, page: pageParam, limit: LIMIT }),
    initialPageParam: 1,
    getNextPageParam: (ultima) => (ultima.page * ultima.limit < ultima.total ? ultima.page + 1 : undefined),
    staleTime: 5 * 60_000,
  });

  const resumen = data?.pages[0]?.resumen;
  const registros = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data]);

  // Agrupar por año preservando el orden DESC del backend.
  const grupos = useMemo(() => {
    const g: { anio: string; items: HistorialGenexisRegistro[] }[] = [];
    for (const r of registros) {
      const a = r.fechaCita.slice(0, 4);
      const ultimo = g[g.length - 1];
      if (ultimo && ultimo.anio === a) ultimo.items.push(r);
      else g.push({ anio: a, items: [r] });
    }
    return g;
  }, [registros]);

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/40" onClick={onClose} />
      <div
        className="fixed z-[80] inset-x-4 top-[4vh] bottom-[4vh] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[640px] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
        role="dialog"
        aria-label="Historial Genexis — Agenda anterior"
      >
        {/* Cabecera */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-start gap-3 shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-900">Historial Genexis — Agenda anterior</p>
            <p className="text-xs text-slate-500 mt-0.5 truncate">{nombrePaciente} · {documento}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-0.5" aria-label="Cerrar">✕</button>
        </div>

        {/* Banner permanente de solo lectura */}
        <div className="px-5 py-2 bg-slate-100 border-b border-slate-200 shrink-0">
          <p className="text-[11px] text-slate-500 leading-snug">
            🔒 Registro histórico congelado. Solo lectura. Estos datos no forman parte de la agenda actual ni de sus indicadores.
          </p>
        </div>

        {/* Resumen + filtros */}
        {resumen && (
          <div className="px-5 py-3 border-b border-slate-100 shrink-0 space-y-2.5">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Atenciones</p>
                <p className="text-lg font-bold text-slate-800 leading-tight">{resumen.totalAtenciones}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Rango</p>
                <p className="text-xs font-medium text-slate-700 leading-tight mt-1">
                  {resumen.primeraCita ? fmtFecha(resumen.primeraCita) : '—'}
                  <span className="text-slate-400"> → </span>
                  {resumen.ultimaCita ? fmtFecha(resumen.ultimaCita) : '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Asistencia histórica</p>
                <p className={cn('text-lg font-bold leading-tight', colorAsistencia(resumen.porcentajeAsistencia))}>
                  {resumen.porcentajeAsistencia !== null ? `${resumen.porcentajeAsistencia}%` : '—'}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <select
                value={sede}
                onChange={(e) => setSede(e.target.value)}
                className="text-xs text-slate-700 border border-slate-200 rounded-md px-2 py-1 bg-white hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-limablue-400"
                aria-label="Filtrar por sede"
              >
                <option value="">Todas las sedes</option>
                {resumen.sedes.filter((s) => s.sede).map((s) => (
                  <option key={s.sede!} value={s.sede!}>{s.sede} ({s.total})</option>
                ))}
              </select>
              <select
                value={anio}
                onChange={(e) => setAnio(e.target.value)}
                className="text-xs text-slate-700 border border-slate-200 rounded-md px-2 py-1 bg-white hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-limablue-400"
                aria-label="Filtrar por año"
              >
                <option value="">Todos los años</option>
                {resumen.anios.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* Cuerpo: línea de tiempo agrupada por año */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="p-5 space-y-3">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          )}

          {isError && (
            <div className="p-8 text-center">
              <p className="text-sm text-slate-500 mb-3">No se pudo cargar el historial.</p>
              <button onClick={() => refetch()} className="btn-secondary btn-sm">Reintentar</button>
            </div>
          )}

          {!isLoading && !isError && registros.length === 0 && (
            <div className="p-8 text-center text-slate-400">
              <p className="text-3xl mb-2">🗂️</p>
              <p className="text-sm">Sin atenciones para los filtros seleccionados</p>
            </div>
          )}

          {grupos.map((grupo) => (
            <Fragment key={grupo.anio}>
              {/* Separador de año pegajoso */}
              <div className="sticky top-0 z-10 px-5 py-1.5 bg-slate-50/95 backdrop-blur border-y border-slate-100">
                <p className="text-xs font-bold text-slate-500 tracking-wide">{grupo.anio}</p>
              </div>
              <div className="px-5 py-3 space-y-2.5">
                {grupo.items.map((r) => {
                  const llego = r.llegoPaciente === 'Sí' ? 'si' : r.llegoPaciente === 'No' ? 'no' : 'sd';
                  const colorSede = colorDeSede(r.sede);
                  return (
                    <div
                      key={r.id}
                      className={cn(
                        'rounded-lg border border-slate-100 bg-white p-3 border-l-4 shadow-sm',
                        llego === 'si' && 'border-l-emerald-400',
                        llego === 'no' && 'border-l-red-300',
                        llego === 'sd' && 'border-l-slate-200'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-sm font-bold text-slate-800">
                          {fmtFecha(r.fechaCita)}
                          {r.horaCita && <span className="ml-1.5 text-slate-500 font-semibold">{r.horaCita} h</span>}
                        </p>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={cn(
                              'text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
                              llego === 'si' && 'bg-emerald-50 text-emerald-700',
                              llego === 'no' && 'bg-red-50 text-red-600',
                              llego === 'sd' && 'bg-slate-100 text-slate-400'
                            )}
                          >
                            {llego === 'si' ? '✓ Llegó' : llego === 'no' ? '✗ No llegó' : 'Sin dato'}
                          </span>
                          {r.sede && (
                            <span
                              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border"
                              style={colorSede
                                ? { color: colorSede, borderColor: `${colorSede}55`, backgroundColor: `${colorSede}14` }
                                : undefined}
                            >
                              {r.sede}
                            </span>
                          )}
                          {r.servicio && (
                            // Gris perla neutro a propósito: el servicio viejo NO pertenece al catálogo actual.
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                              {r.servicio}
                            </span>
                          )}
                        </div>
                      </div>
                      {(r.podologo || r.consultorio) && (
                        <p className="mt-1 text-xs text-slate-500 truncate">
                          {r.podologo}
                          {r.podologo && r.consultorio && <span className="text-slate-300"> · </span>}
                          {r.consultorio}
                        </p>
                      )}
                      {r.obsPaciente && (
                        <div className="mt-1.5 px-2 py-1.5 rounded-md bg-sky-50/70 border border-sky-100">
                          <p className="text-[10px] font-semibold text-sky-600">Obs. Paciente</p>
                          <p className="text-xs text-slate-600 whitespace-pre-wrap break-words">{r.obsPaciente}</p>
                        </div>
                      )}
                      {r.obsPodologo && (
                        <div className="mt-1.5 px-2 py-1.5 rounded-md bg-violet-50/70 border border-violet-100">
                          <p className="text-[10px] font-semibold text-violet-600">Obs. Podólogo</p>
                          <p className="text-xs text-slate-600 whitespace-pre-wrap break-words">{r.obsPodologo}</p>
                        </div>
                      )}
                      {(r.fechaCreacionGx || r.usuarioCreacionGx) && (
                        <p className="mt-1.5 text-[10px] text-slate-400">
                          Registrado{r.fechaCreacionGx && ` el ${r.fechaCreacionGx}`}{r.usuarioCreacionGx && ` por ${r.usuarioCreacionGx}`}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </Fragment>
          ))}

          {hasNextPage && (
            <div className="px-5 pb-5">
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="btn-secondary btn-sm w-full"
              >
                {isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
