import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../stores/authStore';
import {
  videosServicioApi,
  etiquetaMomento,
  fraseMomento,
  type ServicioVideo,
  type ServicioResumen,
  type MomentoVideo,
  type UnidadOffset,
  type VideoInput,
  type VideoSupresion,
} from '../../api/videosServicio';

// ── Helpers ───────────────────────────────────────────────────────────────────
const RE_ID = /(?:youtu\.be\/|shorts\/|embed\/|v=|\/v\/|live\/)([A-Za-z0-9_-]{11})|^([A-Za-z0-9_-]{11})$/;
function extraerId(url: string): string | null {
  const s = url.trim();
  const m = s.match(RE_ID);
  return m ? (m[1] || m[2] || null) : null;
}
/** Offset normalizado a horas (aprox), para ordenar las tarjetas por lejanía a la cita. */
const HORAS_POR_UNIDAD: Record<UnidadOffset, number> = { HORAS: 1, DIAS: 24, MESES: 730, ANIOS: 8760 };
function offsetHoras(v: { offsetValor: number; offsetUnidad: UnidadOffset }): number {
  return v.offsetValor * HORAS_POR_UNIDAD[v.offsetUnidad];
}
function thumb(id: string): string {
  return `https://i.ytimg.com/vi/${id}/oardefault.jpg`;
}
function thumbFallback(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}
// Orden preferido de las unidades en el selector; el resto va al final alfabético.
const ORDEN_UNIDAD = ['Podología', 'Baropodometría', 'Fisioterapia'];
function agruparPorUnidad(servicios: ServicioResumen[]): [string, ServicioResumen[]][] {
  const grupos = new Map<string, ServicioResumen[]>();
  for (const s of servicios) {
    const u = s.unidad ?? 'Otros';
    (grupos.get(u) ?? grupos.set(u, []).get(u)!).push(s);
  }
  return [...grupos.entries()].sort(([a], [b]) => {
    const ia = ORDEN_UNIDAD.indexOf(a), ib = ORDEN_UNIDAD.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });
}

// ── Página ──────────────────────────────────────────────────────────────────
export function VideosServicioPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const esAdmin = useAuthStore((s) => s.isAdmin());

  const [servicioId, setServicioId] = useState<string>('');
  const [selectorAbierto, setSelectorAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [tab, setTab] = useState<'timeline' | 'historial' | 'exclusiones'>('timeline');
  const [modal, setModal] = useState<{ modo: 'crear' | 'editar'; video?: ServicioVideo } | null>(null);
  const [aEliminar, setAEliminar] = useState<ServicioVideo | null>(null);

  const { data: resumen = [] } = useQuery({
    queryKey: ['videos-resumen'],
    queryFn: videosServicioApi.resumen,
    enabled: esAdmin,
  });
  const { data: videos = [], isLoading: cargandoVideos } = useQuery({
    queryKey: ['videos-servicio', servicioId],
    queryFn: () => videosServicioApi.listar(servicioId),
    enabled: esAdmin && !!servicioId,
  });

  const servicioSel = resumen.find((s) => s.id === servicioId) ?? null;

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['videos-servicio', servicioId] });
    qc.invalidateQueries({ queryKey: ['videos-resumen'] });
  };

  // Toggle con feedback optimista + rollback.
  const toggleMut = useMutation({
    mutationFn: (id: string) => videosServicioApi.toggle(id),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['videos-servicio', servicioId] });
      const prev = qc.getQueryData<ServicioVideo[]>(['videos-servicio', servicioId]);
      qc.setQueryData<ServicioVideo[]>(['videos-servicio', servicioId], (old) =>
        (old ?? []).map((v) => (v.id === id ? { ...v, activo: !v.activo } : v)),
      );
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(['videos-servicio', servicioId], ctx.prev);
      toast.error('No se pudo cambiar el estado');
    },
    onSettled: () => invalidar(),
  });

  const testMut = useMutation({
    mutationFn: (id: string) => videosServicioApi.testEnvio(id),
    onSuccess: (r) => toast.success(`Correo de prueba enviado a ${r.to}`),
    onError: (e: Error) => toast.error(e.message),
  });

  const eliminarMut = useMutation({
    mutationFn: (id: string) => videosServicioApi.eliminar(id),
    onSuccess: (r) => {
      invalidar();
      setAEliminar(null);
      toast.success(r.enviosCancelados > 0 ? `Video eliminado · ${r.enviosCancelados} envíos pendientes cancelados` : 'Video eliminado');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const serviciosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const lista = q ? resumen.filter((s) => s.nombre.toLowerCase().includes(q)) : resumen;
    return [...lista].sort((a, b) => b.videos - a.videos || a.nombre.localeCompare(b.nombre));
  }, [resumen, busqueda]);

  const { antes, despues } = useMemo(() => {
    const act = [...videos];
    return {
      antes: act.filter((v) => v.momento === 'ANTES').sort((a, b) => offsetHoras(b) - offsetHoras(a)),
      despues: act.filter((v) => v.momento === 'DESPUES').sort((a, b) => offsetHoras(a) - offsetHoras(b)),
    };
  }, [videos]);

  if (!esAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50 text-slate-400 text-sm">
        Solo un administrador puede configurar los videos por servicio.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3 sticky top-0 z-20">
        <button
          onClick={() => navigate('/herramientas')}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-all"
          title="Volver a Herramientas"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-limablue-500 to-limablue-800 flex items-center justify-center flex-shrink-0">
          <span className="text-white text-lg leading-none">🎬</span>
        </div>
        <div className="flex-1">
          <h1 className="text-base font-bold text-slate-900">Videos por Servicio</h1>
          <p className="text-xs text-slate-500">Envía videos educativos por correo, según el servicio y el momento de la cita.</p>
        </div>
        {/* Tabs */}
        <div className="flex bg-slate-100 rounded-lg p-0.5 text-xs font-semibold">
          <button onClick={() => setTab('timeline')} className={`px-3 py-1.5 rounded-md transition-all ${tab === 'timeline' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Configuración</button>
          <button onClick={() => setTab('historial')} className={`px-3 py-1.5 rounded-md transition-all ${tab === 'historial' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Historial de envíos</button>
          <button onClick={() => setTab('exclusiones')} className={`px-3 py-1.5 rounded-md transition-all ${tab === 'exclusiones' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Correos excluidos</button>
        </div>
      </div>

      {tab === 'timeline' ? (
        <div className="flex-1 p-6 max-w-6xl w-full mx-auto">
          {/* Selector de servicio */}
          <SelectorServicio
            servicios={serviciosFiltrados}
            seleccionado={servicioSel}
            abierto={selectorAbierto}
            busqueda={busqueda}
            onBusqueda={setBusqueda}
            onAbrir={setSelectorAbierto}
            onSeleccionar={(id) => { setServicioId(id); setSelectorAbierto(false); setBusqueda(''); }}
          />

          {!servicioId ? (
            <div className="mt-16 flex flex-col items-center text-center text-slate-400">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4"><span className="text-3xl">🎬</span></div>
              <p className="text-sm font-medium text-slate-500">Elige un servicio para ver y configurar sus videos.</p>
            </div>
          ) : cargandoVideos ? (
            <div className="mt-20 flex justify-center"><span className="w-8 h-8 border-2 border-limablue-300 border-t-limablue-600 rounded-full animate-spin" /></div>
          ) : videos.length === 0 ? (
            <EstadoVacio nombre={servicioSel?.nombre ?? ''} onAgregar={() => setModal({ modo: 'crear' })} />
          ) : (
            <>
              <div className="mt-6 flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Línea de tiempo del paciente</p>
                <button onClick={() => setModal({ modo: 'crear' })} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold text-white bg-limablue-600 hover:bg-limablue-700 transition-all shadow-sm">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  Agregar video
                </button>
              </div>
              <LineaTiempo
                antes={antes}
                despues={despues}
                onEditar={(v) => setModal({ modo: 'editar', video: v })}
                onEliminar={setAEliminar}
                onToggle={(id) => toggleMut.mutate(id)}
                onTest={(id) => testMut.mutate(id)}
                testPendiente={testMut.isPending ? (testMut.variables as string) : null}
              />
            </>
          )}
        </div>
      ) : tab === 'historial' ? (
        <Historial resumen={resumen} />
      ) : (
        <Exclusiones />
      )}

      {modal && (
        <ModalVideo
          modo={modal.modo}
          video={modal.video}
          servicioId={servicioId}
          servicioNombre={servicioSel?.nombre ?? ''}
          onCerrar={() => setModal(null)}
          onGuardado={() => { setModal(null); invalidar(); }}
        />
      )}

      {aEliminar && (
        <ConfirmarEliminar
          video={aEliminar}
          eliminando={eliminarMut.isPending}
          onCancelar={() => setAEliminar(null)}
          onConfirmar={() => eliminarMut.mutate(aEliminar.id)}
        />
      )}
    </div>
  );
}

// ── Selector de servicio (con búsqueda + badges) ─────────────────────────────
function SelectorServicio(props: {
  servicios: ServicioResumen[];
  seleccionado: ServicioResumen | null;
  abierto: boolean;
  busqueda: string;
  onBusqueda: (v: string) => void;
  onAbrir: (v: boolean) => void;
  onSeleccionar: (id: string) => void;
}) {
  const { servicios, seleccionado, abierto, busqueda, onBusqueda, onAbrir, onSeleccionar } = props;
  return (
    <div className="relative max-w-xl">
      <button
        onClick={() => onAbrir(!abierto)}
        className="w-full flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 text-left hover:border-limablue-300 transition-all shadow-sm"
      >
        <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: (seleccionado?.color ?? '#64748b') + '1a' }}>
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: seleccionado?.color ?? '#64748b' }} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold text-slate-900 truncate">{seleccionado ? seleccionado.nombre : 'Selecciona un servicio'}</span>
          <span className="block text-xs text-slate-400">{seleccionado ? seleccionado.unidad : 'Podología, Baropodometría, Fisioterapia…'}</span>
        </span>
        {seleccionado && <BadgeConteo n={seleccionado.videos} />}
        <svg className={`w-4 h-4 text-slate-400 transition-transform ${abierto ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>

      {abierto && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-xl z-30 overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <input
              autoFocus
              value={busqueda}
              onChange={(e) => onBusqueda(e.target.value)}
              placeholder="Buscar servicio…"
              className="w-full px-3 py-2 text-sm bg-slate-50 rounded-lg border border-transparent focus:border-limablue-300 focus:bg-white outline-none"
            />
          </div>
          <div className="max-h-80 overflow-y-auto py-1">
            {servicios.length === 0 && <p className="px-4 py-3 text-xs text-slate-400">Sin resultados</p>}
            {agruparPorUnidad(servicios).map(([unidad, lista]) => (
              <div key={unidad}>
                <p className="sticky top-0 bg-slate-50/95 backdrop-blur px-4 py-1.5 text-xxs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100">{unidad}</p>
                {lista.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onSeleccionar(s.id)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left"
                  >
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="flex-1 min-w-0 text-sm font-medium text-slate-800 truncate">{s.nombre}</span>
                    <BadgeConteo n={s.videos} />
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BadgeConteo({ n }: { n: number }) {
  if (n === 0) return <span className="text-xxs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 whitespace-nowrap">Sin videos</span>;
  return <span className="text-xxs font-bold px-2 py-0.5 rounded-full bg-limablue-100 text-limablue-700 whitespace-nowrap">{n} video{n === 1 ? '' : 's'}</span>;
}

// ── Estado vacío ──────────────────────────────────────────────────────────────
function EstadoVacio({ nombre, onAgregar }: { nombre: string; onAgregar: () => void }) {
  return (
    <div className="mt-12 flex flex-col items-center text-center">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center mb-5">
        <svg className="w-9 h-9 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
      </div>
      <h3 className="text-base font-bold text-slate-800">{nombre} aún no tiene videos configurados</h3>
      <p className="text-sm text-slate-500 mt-1 max-w-sm">Agrega el primer video para empezar a enviar contenido educativo a los pacientes de este servicio.</p>
      <button onClick={onAgregar} className="mt-5 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-limablue-600 hover:bg-limablue-700 transition-all shadow-sm">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
        Agregar primer video
      </button>
    </div>
  );
}

// ── Línea de tiempo (firma visual) ────────────────────────────────────────────
function LineaTiempo(props: {
  antes: ServicioVideo[];
  despues: ServicioVideo[];
  onEditar: (v: ServicioVideo) => void;
  onEliminar: (v: ServicioVideo) => void;
  onToggle: (id: string) => void;
  onTest: (id: string) => void;
  testPendiente: string | null;
}) {
  const { antes, despues, onEditar, onEliminar, onToggle, onTest, testPendiente } = props;
  const cardProps = { onEditar, onEliminar, onToggle, onTest, testPendiente };
  return (
    <div className="mt-4 bg-white border border-slate-200 rounded-2xl p-5 lg:p-8 shadow-sm">
      {/* Encabezados de zona */}
      <div className="hidden lg:flex items-center justify-between mb-4 px-1">
        <span className="text-xs font-bold text-amber-600 uppercase tracking-widest">← Antes de la cita</span>
        <span className="text-xs font-bold text-emerald-600 uppercase tracking-widest">Después de la cita →</span>
      </div>

      {/* Desktop: horizontal. Mobile: columna. */}
      <div className="flex flex-col lg:flex-row lg:items-stretch gap-4 lg:gap-3 relative">
        {/* Eje horizontal (solo desktop) */}
        <div className="hidden lg:block absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-amber-200 via-limablue-300 to-emerald-200" />

        {/* ANTES */}
        <div className="lg:hidden text-xs font-bold text-amber-600 uppercase tracking-widest">Antes de la cita</div>
        <div className="flex-1 flex flex-col lg:flex-row lg:justify-end gap-3 relative">
          {antes.length === 0 && <ZonaVacia texto="Sin videos antes" />}
          {antes.map((v) => <TarjetaVideo key={v.id} v={v} {...cardProps} />)}
        </div>

        {/* Marcador de la cita */}
        <div className="flex lg:flex-col items-center justify-center gap-2 relative z-10 lg:px-2">
          <div className="w-px h-6 lg:w-px lg:h-full bg-slate-200 lg:hidden" />
          <div className="flex flex-col items-center">
            <div className="w-14 h-14 rounded-2xl bg-limablue-900 text-white flex items-center justify-center shadow-lg ring-4 ring-white">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            </div>
            <span className="mt-1.5 text-xxs font-bold text-limablue-900 uppercase tracking-wider">La cita</span>
          </div>
        </div>

        {/* DESPUÉS */}
        <div className="lg:hidden text-xs font-bold text-emerald-600 uppercase tracking-widest mt-1">Después de la cita</div>
        <div className="flex-1 flex flex-col lg:flex-row lg:justify-start gap-3 relative">
          {despues.length === 0 && <ZonaVacia texto="Sin videos después" />}
          {despues.map((v) => <TarjetaVideo key={v.id} v={v} {...cardProps} />)}
        </div>
      </div>
    </div>
  );
}

function ZonaVacia({ texto }: { texto: string }) {
  return (
    <div className="flex-1 min-h-[7rem] rounded-xl border border-dashed border-slate-200 flex items-center justify-center text-xxs text-slate-300 font-medium">
      {texto}
    </div>
  );
}

// ── Tarjeta de video ──────────────────────────────────────────────────────────
function TarjetaVideo(props: {
  v: ServicioVideo;
  onEditar: (v: ServicioVideo) => void;
  onEliminar: (v: ServicioVideo) => void;
  onToggle: (id: string) => void;
  onTest: (id: string) => void;
  testPendiente: string | null;
}) {
  const { v, onEditar, onEliminar, onToggle, onTest, testPendiente } = props;
  return (
    <div className={`w-full lg:w-40 bg-white border rounded-2xl overflow-hidden shadow-sm transition-all ${v.activo ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
      {/* Mini-thumbnail vertical */}
      <div className="relative bg-slate-900 flex justify-center">
        <img
          src={thumb(v.youtubeVideoId)}
          onError={(e) => { const t = e.currentTarget; if (!t.dataset.fb) { t.dataset.fb = '1'; t.src = thumbFallback(v.youtubeVideoId); } }}
          alt=""
          className="w-full h-28 object-cover"
        />
        <span className="absolute top-2 left-2 text-xxs font-bold px-1.5 py-0.5 rounded-md bg-black/55 text-white">{etiquetaMomento(v.momento, v.offsetValor, v.offsetUnidad)}</span>
        {!v.activo && <span className="absolute top-2 right-2 text-xxs font-bold px-1.5 py-0.5 rounded-md bg-slate-800/80 text-slate-200">Pausado</span>}
      </div>
      <div className="p-2.5">
        <p className="text-xs font-bold text-slate-800 leading-snug line-clamp-2 min-h-[2rem]" title={v.tituloVideo}>{v.tituloVideo}</p>
        <div className="mt-2 flex items-center justify-between">
          <button
            onClick={() => onToggle(v.id)}
            title={v.activo ? 'Pausar' : 'Activar'}
            className={`text-xxs font-bold px-2 py-1 rounded-md transition-colors ${v.activo ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
          >
            {v.activo ? 'Activo' : 'Pausado'}
          </button>
          <div className="flex items-center gap-0.5">
            <IconBtn title="Enviar prueba" onClick={() => onTest(v.id)} loading={testPendiente === v.id}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </IconBtn>
            <IconBtn title="Editar" onClick={() => onEditar(v)}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </IconBtn>
            <IconBtn title="Eliminar" danger onClick={() => onEliminar(v)}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </IconBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

function IconBtn({ children, title, onClick, danger, loading }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean; loading?: boolean }) {
  return (
    <button onClick={onClick} title={title} disabled={loading} className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${danger ? 'text-slate-400 hover:bg-red-50 hover:text-red-600' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'} disabled:opacity-40`}>
      {loading ? <span className="w-3.5 h-3.5 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" /> : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">{children}</svg>}
    </button>
  );
}

// ── Modal crear/editar ────────────────────────────────────────────────────────
function ModalVideo(props: {
  modo: 'crear' | 'editar';
  video?: ServicioVideo;
  servicioId: string;
  servicioNombre: string;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const { modo, video, servicioId, servicioNombre, onCerrar, onGuardado } = props;
  const qc = useQueryClient();

  const [youtubeUrl, setUrl] = useState(video?.youtubeUrl ?? '');
  const [asunto, setAsunto] = useState(video?.asunto ?? '');
  const [tituloVideo, setTitulo] = useState(video?.tituloVideo ?? '');
  const [cuerpoTexto, setCuerpo] = useState(video?.cuerpoTexto ?? '');
  const [momento, setMomento] = useState<MomentoVideo>(video?.momento ?? 'ANTES');
  const [offsetValor, setValor] = useState<number>(video?.offsetValor ?? 24);
  const [offsetUnidad, setUnidad] = useState<UnidadOffset>(video?.offsetUnidad ?? 'HORAS');
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  const videoId = extraerId(youtubeUrl);
  const urlValida = youtubeUrl.trim().length > 0 && !!videoId;

  const guardarMut = useMutation({
    mutationFn: () => {
      const payload = { youtubeUrl, asunto, tituloVideo, cuerpoTexto, momento, offsetValor, offsetUnidad };
      return modo === 'crear'
        ? videosServicioApi.crear({ servicioId, ...payload } as VideoInput)
        : videosServicioApi.editar(video!.id, payload);
    },
    onSuccess: () => toast.success(modo === 'crear' ? 'Video agregado' : 'Video actualizado'),
    onError: (e: Error) => toast.error(e.message),
  });

  const previewMut = useMutation({
    mutationFn: () => videosServicioApi.preview({ asunto, tituloVideo, cuerpoTexto, youtubeUrl }),
    onSuccess: (r) => setPreviewHtml(r.html),
    onError: (e: Error) => toast.error(e.message),
  });

  const puedeGuardar = urlValida && asunto.trim() && tituloVideo.trim() && cuerpoTexto.trim() && offsetValor > 0;

  const guardar = async () => {
    if (!puedeGuardar) return;
    await guardarMut.mutateAsync();
    qc.invalidateQueries({ queryKey: ['videos-servicio', servicioId] });
    onGuardado();
  };

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900">{modo === 'crear' ? 'Agregar video' : 'Editar video'}</h2>
            <p className="text-xs text-slate-400">{servicioNombre}</p>
          </div>
          <button onClick={onCerrar} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>

        <div className="grid md:grid-cols-2 gap-5 p-6">
          {/* Columna izquierda: formulario */}
          <div className="space-y-4">
            <Campo label="URL de YouTube" hint="Video No listado (unlisted)">
              <input value={youtubeUrl} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtube.com/shorts/…" className={`w-full px-3 py-2 text-sm rounded-lg border outline-none transition-colors ${youtubeUrl && !urlValida ? 'border-red-300 focus:border-red-400' : 'border-slate-200 focus:border-limablue-400'}`} />
              {youtubeUrl && !urlValida && <p className="mt-1 text-xxs font-medium text-red-500">No reconozco el video. Usa un enlace watch?v=, youtu.be/ o /shorts/.</p>}
            </Campo>

            <Campo label="Asunto del correo" contador={`${asunto.length}/120`}>
              <input value={asunto} maxLength={120} onChange={(e) => setAsunto(e.target.value)} placeholder="Un video antes de tu cita en Limablue" className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-limablue-400 outline-none" />
            </Campo>

            <Campo label="Título del video" contador={`${tituloVideo.length}/100`}>
              <input value={tituloVideo} maxLength={100} onChange={(e) => setTitulo(e.target.value)} placeholder="Cómo prepararte para tu quiropodia" className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-limablue-400 outline-none" />
            </Campo>

            <Campo label="Cuerpo del correo" contador={`${cuerpoTexto.length}/300`} hint="Mantén el texto corto">
              <textarea value={cuerpoTexto} maxLength={300} rows={3} onChange={(e) => setCuerpo(e.target.value)} placeholder="Mira este video breve antes de tu visita." className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-limablue-400 outline-none resize-none" />
            </Campo>

            {/* Momento */}
            <Campo label="¿Cuándo se envía?">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex bg-slate-100 rounded-lg p-0.5 text-xs font-semibold">
                  <button onClick={() => setMomento('ANTES')} className={`px-3 py-1.5 rounded-md transition-all ${momento === 'ANTES' ? 'bg-white text-amber-700 shadow-sm' : 'text-slate-500'}`}>Antes</button>
                  <button onClick={() => setMomento('DESPUES')} className={`px-3 py-1.5 rounded-md transition-all ${momento === 'DESPUES' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500'}`}>Después</button>
                </div>
                <input type="number" min={1} max={999} value={offsetValor} onChange={(e) => setValor(Math.min(999, Math.max(1, parseInt(e.target.value || '1', 10))))} className="w-16 px-2 py-1.5 text-sm rounded-lg border border-slate-200 focus:border-limablue-400 outline-none text-center" />
                <select value={offsetUnidad} onChange={(e) => setUnidad(e.target.value as UnidadOffset)} className="px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 focus:border-limablue-400 outline-none bg-white font-medium text-slate-700">
                  <option value="HORAS">Horas</option>
                  <option value="DIAS">Días</option>
                  <option value="MESES">Meses</option>
                  <option value="ANIOS">Años</option>
                </select>
              </div>
              <p className={`mt-2 text-xs font-semibold ${momento === 'ANTES' ? 'text-amber-600' : 'text-emerald-600'}`}>{fraseMomento(momento, offsetValor, offsetUnidad)}</p>
            </Campo>
          </div>

          {/* Columna derecha: preview embebido */}
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-2">Vista previa del video</p>
            <div className="bg-slate-900 rounded-2xl overflow-hidden mx-auto" style={{ maxWidth: 220 }}>
              <div className="relative" style={{ paddingBottom: '177.78%' }}>
                {urlValida ? (
                  <iframe
                    className="absolute inset-0 w-full h-full"
                    src={`https://www.youtube-nocookie.com/embed/${videoId}?fs=1`}
                    title="Vista previa"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-xs px-4 text-center">Pega la URL para previsualizar</div>
                )}
              </div>
            </div>
            <button
              onClick={() => previewMut.mutate()}
              disabled={!urlValida || previewMut.isPending}
              className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-limablue-700 bg-limablue-50 hover:bg-limablue-100 disabled:opacity-40 transition-colors"
            >
              {previewMut.isPending ? 'Generando…' : '✉️ Vista previa del correo'}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <button onClick={onCerrar} className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors">Cancelar</button>
          <button onClick={guardar} disabled={!puedeGuardar || guardarMut.isPending} className="px-5 py-2 rounded-xl text-sm font-semibold text-white bg-limablue-600 hover:bg-limablue-700 disabled:opacity-40 transition-all shadow-sm">
            {guardarMut.isPending ? 'Guardando…' : modo === 'crear' ? 'Agregar video' : 'Guardar cambios'}
          </button>
        </div>
      </div>

      {previewHtml !== null && <PreviewCorreo html={previewHtml} onCerrar={() => setPreviewHtml(null)} />}
    </div>
  );
}

function Campo({ label, hint, contador, children }: { label: string; hint?: string; contador?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-semibold text-slate-700">{label}{hint && <span className="ml-1.5 font-normal text-slate-400">· {hint}</span>}</label>
        {contador && <span className="text-xxs text-slate-400">{contador}</span>}
      </div>
      {children}
    </div>
  );
}

// ── Vista previa del correo real (HTML del backend) ──────────────────────────
function PreviewCorreo({ html, onCerrar }: { html: string; onCerrar: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCerrar}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-900">Vista previa del correo</h3>
          <button onClick={onCerrar} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        <iframe srcDoc={html} title="Correo" className="w-full flex-1 min-h-[60vh] bg-white" sandbox="" />
      </div>
    </div>
  );
}

// ── Confirmar eliminación ─────────────────────────────────────────────────────
function ConfirmarEliminar({ video, eliminando, onCancelar, onConfirmar }: { video: ServicioVideo; eliminando: boolean; onCancelar: () => void; onConfirmar: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCancelar}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mb-4"><svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M4 7h16" /></svg></div>
        <h3 className="text-base font-bold text-slate-900">Eliminar este video</h3>
        <p className="text-sm text-slate-500 mt-1">Se eliminará <strong className="text-slate-700">“{video.tituloVideo}”</strong>. Los envíos que ya estaban programados y aún no salen se cancelarán. Esta acción no borra los correos ya enviados.</p>
        <div className="flex items-center justify-end gap-2 mt-6">
          <button onClick={onCancelar} className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors">Cancelar</button>
          <button onClick={onConfirmar} disabled={eliminando} className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 transition-all">{eliminando ? 'Eliminando…' : 'Eliminar'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Historial de envíos (CAPA 4) ──────────────────────────────────────────────
const ESTADO_STYLE: Record<string, string> = {
  PENDIENTE: 'bg-sky-100 text-sky-700',
  ENVIADO: 'bg-emerald-100 text-emerald-700',
  CANCELADO: 'bg-slate-100 text-slate-500',
  ERROR: 'bg-red-100 text-red-700',
};

function Historial({ resumen }: { resumen: ServicioResumen[] }) {
  const [servicioId, setServicioId] = useState('');
  const [estado, setEstado] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (servicioId) p.servicioId = servicioId;
    if (estado) p.estado = estado;
    if (desde) p.desde = desde;
    if (hasta) p.hasta = hasta;
    return p;
  }, [servicioId, estado, desde, hasta]);

  const { data: filas = [], isLoading } = useQuery({
    queryKey: ['videos-historial', params],
    queryFn: () => videosServicioApi.historial(params),
  });

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' }) : '—');

  return (
    <div className="flex-1 p-6 max-w-6xl w-full mx-auto">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <FiltroSelect label="Servicio" value={servicioId} onChange={setServicioId} options={[{ v: '', t: 'Todos' }, ...resumen.map((s) => ({ v: s.id, t: s.nombre }))]} />
        <FiltroSelect label="Estado" value={estado} onChange={setEstado} options={[{ v: '', t: 'Todos' }, { v: 'PENDIENTE', t: 'Pendiente' }, { v: 'ENVIADO', t: 'Enviado' }, { v: 'CANCELADO', t: 'Cancelado' }, { v: 'ERROR', t: 'Error' }]} />
        <div><label className="block text-xxs font-semibold text-slate-500 uppercase tracking-wide mb-1">Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-limablue-400 outline-none" /></div>
        <div><label className="block text-xxs font-semibold text-slate-500 uppercase tracking-wide mb-1">Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-limablue-400 outline-none" /></div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xxs font-bold text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3">Paciente</th><th className="px-4 py-3">Video</th><th className="px-4 py-3">Servicio</th>
                <th className="px-4 py-3">Programado</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Enviado / Detalle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center"><span className="inline-block w-6 h-6 border-2 border-limablue-300 border-t-limablue-600 rounded-full animate-spin" /></td></tr>
              ) : filas.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">No hay envíos que coincidan con los filtros.</td></tr>
              ) : filas.map((f) => (
                <tr key={f.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3"><div className="font-medium text-slate-800">{f.paciente ?? '—'}</div><div className="text-xxs text-slate-400">{f.email}</div></td>
                  <td className="px-4 py-3 text-slate-600 max-w-[12rem] truncate" title={f.video ?? ''}>{f.video ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{f.servicio ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmt(f.scheduledFor)}</td>
                  <td className="px-4 py-3"><span className={`text-xxs font-bold px-2 py-0.5 rounded-full ${ESTADO_STYLE[f.estado] ?? 'bg-slate-100 text-slate-500'}`}>{f.estado}</span></td>
                  <td className="px-4 py-3 text-xxs text-slate-500">
                    {f.estado === 'ENVIADO' ? fmt(f.sentAt) : f.estado === 'CANCELADO' ? (f.motivoCancelacion ?? '—') : f.error ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Correos excluidos (opt-out de videos educativos) ─────────────────────────
function Exclusiones() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [motivo, setMotivo] = useState('');

  const { data: lista = [], isLoading } = useQuery({
    queryKey: ['videos-supresiones'],
    queryFn: videosServicioApi.listarSupresiones,
  });
  const invalidar = () => qc.invalidateQueries({ queryKey: ['videos-supresiones'] });

  const agregarMut = useMutation({
    mutationFn: () => videosServicioApi.agregarSupresion(email.trim(), motivo.trim() || undefined),
    onSuccess: (r) => {
      invalidar(); setEmail(''); setMotivo('');
      toast.success(r.enviosCancelados > 0 ? `Correo excluido · ${r.enviosCancelados} envío(s) pendiente(s) cancelado(s)` : 'Correo excluido de los videos');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const quitarMut = useMutation({
    mutationFn: (id: string) => videosServicioApi.quitarSupresion(id),
    onSuccess: () => { invalidar(); toast.success('Correo reactivado'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  return (
    <div className="flex-1 p-6 max-w-2xl w-full mx-auto">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 mb-5 flex gap-2.5">
        <span className="text-lg leading-none">🔕</span>
        <p className="text-xs text-amber-800 leading-relaxed">
          Los correos de esta lista <strong>no recibirán los videos educativos</strong> (antes ni después de la cita).
          Sí seguirán recibiendo los correos de <strong>confirmación de cita</strong>.
        </p>
      </div>

      {/* Agregar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Excluir un correo</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && emailValido) agregarMut.mutate(); }}
            placeholder="correo@ejemplo.com"
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-limablue-400 outline-none"
          />
          <input
            type="text"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo (opcional)"
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-limablue-400 outline-none"
          />
          <button
            onClick={() => agregarMut.mutate()}
            disabled={!emailValido || agregarMut.isPending}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-limablue-600 hover:bg-limablue-700 disabled:opacity-40 transition-all whitespace-nowrap"
          >
            {agregarMut.isPending ? 'Agregando…' : 'Excluir'}
          </button>
        </div>
      </div>

      {/* Lista */}
      <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 px-1">
        Excluidos {lista.length > 0 && <span className="text-slate-400">· {lista.length}</span>}
      </p>
      {isLoading ? (
        <div className="flex justify-center py-8"><span className="w-6 h-6 border-2 border-limablue-300 border-t-limablue-600 rounded-full animate-spin" /></div>
      ) : lista.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-6">Ningún correo excluido. Todos los pacientes con correo reciben los videos.</p>
      ) : (
        <ul className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
          {lista.map((s: VideoSupresion) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <span className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0 text-slate-400">🔕</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{s.email}</p>
                {s.motivo && <p className="text-xxs text-slate-400 truncate">{s.motivo}</p>}
              </div>
              <button
                onClick={() => quitarMut.mutate(s.id)}
                disabled={quitarMut.isPending}
                className="text-xxs font-semibold px-2.5 py-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors disabled:opacity-40 whitespace-nowrap"
              >
                Reactivar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FiltroSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { v: string; t: string }[] }) {
  return (
    <div>
      <label className="block text-xxs font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-limablue-400 outline-none bg-white min-w-[10rem]">
        {options.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
      </select>
    </div>
  );
}
