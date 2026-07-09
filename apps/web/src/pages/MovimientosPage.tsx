import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO, differenceInCalendarDays, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { cn } from '../utils/cn';
import { sedesApi, type Sede } from '../api';
import { movimientosApi, MOTIVO_LABELS, type Movimiento } from '../api/movimientos';
import { MovimientoModal } from '../components/movimientos/MovimientoModal';
import { useAuthStore } from '../stores/authStore';

type Vista = 'hoy' | 'proximo' | 'historial';

// ─── Helpers de dominio ───────────────────────────────────────────────────────

/** Color del acento + badge por motivo, alineado con la paleta del resto de la app. */
const MOTIVO_STYLE: Record<string, { badge: string; accent: string }> = {
  VACACIONES:          { badge: 'bg-sky-100 text-sky-700',        accent: 'border-l-sky-400' },
  CAMBIO_POR_TIEMPO:   { badge: 'bg-violet-100 text-violet-700',  accent: 'border-l-violet-400' },
  CERCANIA_A_CASA:     { badge: 'bg-emerald-100 text-emerald-700', accent: 'border-l-emerald-400' },
  PROBLEMAS_INTERNOS:  { badge: 'bg-red-100 text-red-700',        accent: 'border-l-red-400' },
  COBERTURA_EMERGENCIA:{ badge: 'bg-amber-100 text-amber-700',    accent: 'border-l-amber-400' },
  OTRO:                { badge: 'bg-slate-100 text-slate-600',    accent: 'border-l-slate-300' },
};

/** Una podóloga es "cobertura" (cambio temporal) si tiene motivo específico o fecha de fin. */
const esCobertura = (m: Movimiento) => m.motivo !== 'OTRO' || !!m.fechaFin;

// Los campos son @db.Date (medianoche UTC); parsear solo YYYY-MM-DD evita el desfase −1 día en Lima.
const soloFecha = (iso: string) => parseISO(iso.slice(0, 10));

const rangoFechas = (m: Movimiento) => {
  const ini = format(soloFecha(m.fechaInicio), "d MMM", { locale: es });
  if (!m.fechaFin) return `Desde ${ini}`;
  return `${ini} → ${format(soloFecha(m.fechaFin), "d MMM", { locale: es })}`;
};

const cuentaRegresiva = (m: Movimiento) => {
  const dias = differenceInCalendarDays(soloFecha(m.fechaInicio), new Date());
  if (dias <= 0) return 'Hoy';
  if (dias === 1) return 'Mañana';
  if (dias <= 30) return `En ${dias} días`;
  return null;
};

const iniciales = (p: { nombres: string; apellidos: string }) =>
  `${p.nombres[0] ?? ''}${p.apellidos[0] ?? ''}`.toUpperCase();

// ─── Piezas visuales ──────────────────────────────────────────────────────────

function Avatar({ prof, size = 'md' }: { prof: Movimiento['profesional']; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn(
        'rounded-full flex items-center justify-center text-white font-bold shrink-0',
        size === 'sm' ? 'w-7 h-7 text-[10px]' : 'w-9 h-9 text-xs',
      )}
      style={{ backgroundColor: prof.colorAvatar }}
    >
      {iniciales(prof)}
    </span>
  );
}

function BadgeMotivo({ motivo }: { motivo: string }) {
  const label = MOTIVO_LABELS[motivo as keyof typeof MOTIVO_LABELS] ?? motivo;
  const style = MOTIVO_STYLE[motivo] ?? MOTIVO_STYLE.OTRO;
  return (
    <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap', style.badge)}>
      {label}
    </span>
  );
}

function IconBtn({ label, onClick, danger, children }: {
  label: string; onClick: () => void; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'w-7 h-7 grid place-items-center rounded-lg text-slate-400 transition-colors',
        danger ? 'hover:bg-red-50 hover:text-red-500' : 'hover:bg-slate-100 hover:text-limablue-600',
      )}
    >
      {children}
    </button>
  );
}

const IconLapiz = (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.86 4.49l2.65 2.65M4 20l4.24-.71 9.6-9.6a1.5 1.5 0 000-2.12l-1.4-1.41a1.5 1.5 0 00-2.12 0l-9.6 9.6L4 20z" />
  </svg>
);
const IconTacho = (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 7h14M10 11v6M14 11v6M6 7l1 12a1 1 0 001 1h8a1 1 0 001-1l1-12M9 7V4h6v3" />
  </svg>
);

// ─── Tarjeta de podóloga (tablero) ────────────────────────────────────────────

function PodologaCard({ mov, canWrite, onEditar, onEliminar }: {
  mov: Movimiento; canWrite: boolean;
  onEditar: (m: Movimiento) => void; onEliminar: (m: Movimiento) => void;
}) {
  const cobertura = esCobertura(mov);
  const style = MOTIVO_STYLE[mov.motivo] ?? MOTIVO_STYLE.OTRO;
  const puedeEliminar = canWrite && mov.estadoCalc !== 'historial';

  return (
    <div className={cn(
      'group relative bg-white rounded-xl border border-slate-200 py-2.5 pl-3 pr-1.5 flex items-start gap-2.5 transition-shadow hover:shadow-sm',
      cobertura && cn('border-l-[3px]', style.accent),
    )}>
      <Avatar prof={mov.profesional} size="sm" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[13px] text-slate-900 leading-tight truncate">
          {mov.profesional.nombres} {mov.profesional.apellidos}
        </p>
        {cobertura ? (
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <BadgeMotivo motivo={mov.motivo} />
            <span className="text-[11px] text-slate-500">{rangoFechas(mov)}</span>
          </div>
        ) : (
          <p className="text-[11px] text-slate-400 mt-0.5">Asignación fija</p>
        )}
        {mov.reemplazaProfesional && (
          <p className="text-[11px] text-slate-400 mt-0.5 truncate">
            Cubre a {mov.reemplazaProfesional.nombres} {mov.reemplazaProfesional.apellidos}
          </p>
        )}
      </div>
      {canWrite && (
        <div className="flex shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <IconBtn label="Editar" onClick={() => onEditar(mov)}>{IconLapiz}</IconBtn>
          {puedeEliminar && <IconBtn label="Eliminar" danger onClick={() => onEliminar(mov)}>{IconTacho}</IconBtn>}
        </div>
      )}
    </div>
  );
}

// ─── Columna de sede (tablero) ────────────────────────────────────────────────

function SedeColumn({ sede, movs, proximos, canWrite, onNuevo, onEditar, onEliminar, onVerProximos }: {
  sede: Sede;
  movs: Movimiento[];
  proximos: number;
  canWrite: boolean;
  onNuevo: (sede: Sede) => void;
  onEditar: (m: Movimiento) => void;
  onEliminar: (m: Movimiento) => void;
  onVerProximos: () => void;
}) {
  // Coberturas temporales arriba (lo que hay que vigilar), luego las fijas; ambas alfabéticas.
  const ordenados = [...movs].sort((a, b) => {
    const ca = esCobertura(a) ? 0 : 1;
    const cb = esCobertura(b) ? 0 : 1;
    if (ca !== cb) return ca - cb;
    return a.profesional.nombres.localeCompare(b.profesional.nombres);
  });

  return (
    <div className="flex flex-col bg-slate-50 rounded-2xl border border-slate-200/80 lg:w-72 lg:shrink-0">
      {/* Encabezado */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-200/80">
        <span className="w-1.5 h-5 rounded-full shrink-0" style={{ backgroundColor: sede.color }} />
        <span className="font-semibold text-sm text-slate-800 flex-1 truncate">{sede.nombre}</span>
        <span className="text-xs font-semibold text-slate-500 bg-white border border-slate-200 rounded-full px-2 py-0.5">
          {movs.length}
        </span>
        {canWrite && (
          <button
            onClick={() => onNuevo(sede)}
            title={`Agregar movimiento en ${sede.nombre}`}
            aria-label={`Agregar movimiento en ${sede.nombre}`}
            className="w-7 h-7 grid place-items-center rounded-lg text-slate-400 hover:bg-limablue-50 hover:text-limablue-600 transition-colors text-lg leading-none"
          >
            +
          </button>
        )}
      </div>

      {/* Lista de podólogas */}
      <div className="p-2 space-y-2 lg:overflow-y-auto lg:max-h-[calc(100vh-19rem)]">
        {ordenados.length ? (
          ordenados.map(m => (
            <PodologaCard key={m.id} mov={m} canWrite={canWrite} onEditar={onEditar} onEliminar={onEliminar} />
          ))
        ) : (
          <p className="text-xs text-slate-400 text-center py-6">Sin podólogas asignadas</p>
        )}
      </div>

      {/* Pie: próximos cambios en esta sede */}
      {proximos > 0 && (
        <button
          onClick={onVerProximos}
          className="text-[11px] font-medium text-limablue-600 hover:text-limablue-700 hover:bg-limablue-50/60 text-left px-3 py-2 border-t border-slate-200/80 rounded-b-2xl transition-colors"
        >
          {proximos === 1 ? '1 cambio programado' : `${proximos} cambios programados`} →
        </button>
      )}
    </div>
  );
}

// ─── Fila de lista (Próximos / Historial) ─────────────────────────────────────

function MovimientoFila({ mov, canWrite, onEditar, onEliminar, atenuado }: {
  mov: Movimiento; canWrite: boolean;
  onEditar: (m: Movimiento) => void; onEliminar: (m: Movimiento) => void;
  atenuado?: boolean;
}) {
  const inicio = soloFecha(mov.fechaInicio);
  const countdown = cuentaRegresiva(mov);
  const puedeEliminar = canWrite && mov.estadoCalc !== 'historial';

  return (
    <div className={cn(
      'group bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4 transition-shadow hover:shadow-sm',
      atenuado && 'opacity-75',
    )}>
      {/* Riel de fecha */}
      <div className="text-center w-14 shrink-0">
        <div className={cn('text-2xl font-bold leading-none', atenuado ? 'text-slate-400' : 'text-limablue-600')}>
          {format(inicio, 'd')}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mt-0.5">
          {format(inicio, 'MMM', { locale: es })}
        </div>
        {!atenuado && countdown && (
          <div className="text-[10px] font-semibold text-amber-600 mt-1">{countdown}</div>
        )}
      </div>

      <div className="w-px self-stretch bg-slate-100 shrink-0" />

      <Avatar prof={mov.profesional} />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-slate-900 leading-tight truncate">
          {mov.profesional.nombres} {mov.profesional.apellidos}
        </p>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: mov.sede.color }} />
          <span className="text-xs font-medium text-slate-700 truncate">{mov.sede.nombre}</span>
          <span className="text-xs text-slate-400">· {rangoFechas(mov)}</span>
        </div>
        {mov.reemplazaProfesional && (
          <p className="text-xs text-slate-400 mt-0.5 truncate">
            Cubre a {mov.reemplazaProfesional.nombres} {mov.reemplazaProfesional.apellidos}
          </p>
        )}
        {mov.notas && <p className="text-xs text-slate-400 mt-0.5 italic truncate">{mov.notas}</p>}
      </div>

      <BadgeMotivo motivo={mov.motivo} />

      {canWrite && (
        <div className="flex shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <IconBtn label="Editar" onClick={() => onEditar(mov)}>{IconLapiz}</IconBtn>
          {puedeEliminar && <IconBtn label="Eliminar" danger onClick={() => onEliminar(mov)}>{IconTacho}</IconBtn>}
        </div>
      )}
    </div>
  );
}

// ─── Navegador de fecha (tablero) ─────────────────────────────────────────────

const IconChevron = ({ dir }: { dir: 'izq' | 'der' }) => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d={dir === 'izq' ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'} />
  </svg>
);

function NavegadorFecha({ fecha, hoy, onChange }: {
  fecha: string; hoy: string; onChange: (f: string) => void;
}) {
  const d = parseISO(fecha);
  const esHoy = fecha === hoy;
  const dias = differenceInCalendarDays(d, parseISO(hoy));
  const relativo = esHoy ? 'Hoy' : dias === 1 ? 'Mañana' : dias > 0 ? `En ${dias} días` : null;

  return (
    <div className="flex items-center gap-2.5 flex-wrap">
      <div className="inline-flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden">
        <button
          onClick={() => onChange(format(addDays(d, -1), 'yyyy-MM-dd'))}
          disabled={esHoy}
          aria-label="Día anterior"
          className="w-8 h-8 grid place-items-center text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <IconChevron dir="izq" />
        </button>
        <label className="relative flex items-center gap-2 px-3 h-8 border-x border-slate-200 cursor-pointer hover:bg-slate-50 transition-colors">
          <svg className="w-4 h-4 text-limablue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3M4 11h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z" />
          </svg>
          <span className="text-sm font-semibold text-slate-800 first-letter:uppercase whitespace-nowrap">
            {format(d, "EEE d 'de' MMM", { locale: es })}
          </span>
          <input
            type="date"
            value={fecha}
            min={hoy}
            onChange={e => e.target.value && onChange(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer"
            aria-label="Elegir fecha"
          />
        </label>
        <button
          onClick={() => onChange(format(addDays(d, 1), 'yyyy-MM-dd'))}
          aria-label="Día siguiente"
          className="w-8 h-8 grid place-items-center text-slate-500 hover:bg-slate-50 transition-colors"
        >
          <IconChevron dir="der" />
        </button>
      </div>

      {relativo && (
        <span className={cn(
          'text-xs font-semibold px-2 py-1 rounded-full',
          esHoy ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700',
        )}>
          {relativo}
        </span>
      )}

      {!esHoy && (
        <button onClick={() => onChange(hoy)} className="text-xs font-medium text-limablue-600 hover:underline">
          Volver a hoy
        </button>
      )}
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export function MovimientosPage() {
  const [vista, setVista] = useState<Vista>('hoy');
  const [busqueda, setBusqueda] = useState('');
  const [modalAbierto, setModalAbierto] = useState(false);
  const [editando, setEditando] = useState<Movimiento | null>(null);
  const [sedePrefill, setSedePrefill] = useState<string | undefined>();
  const hoyStr = format(new Date(), 'yyyy-MM-dd');
  const [fechaVista, setFechaVista] = useState(hoyStr);
  const qc = useQueryClient();
  const { usuario } = useAuthStore();
  const canWrite = usuario?.rol === 'admin' || usuario?.rol === 'coordinadora_sedes';

  const { data: sedes } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });

  const activosQ = useQuery({
    queryKey: ['movimientos', 'activo'],
    queryFn: () => movimientosApi.listar({ estado: 'activo' }),
  });
  const proximosQ = useQuery({
    queryKey: ['movimientos', 'proximo'],
    queryFn: () => movimientosApi.listar({ estado: 'proximo' }),
  });
  const historialQ = useQuery({
    queryKey: ['movimientos', 'historial'],
    queryFn: () => movimientosApi.listar({ estado: 'historial' }),
    enabled: vista === 'historial',
  });

  const abrirNuevo = (sedeId?: string) => {
    setEditando(null);
    setSedePrefill(sedeId);
    setModalAbierto(true);
  };
  const abrirEditar = (m: Movimiento) => {
    setEditando(m);
    setSedePrefill(undefined);
    setModalAbierto(true);
  };
  const cerrarModal = () => {
    setModalAbierto(false);
    setEditando(null);
    setSedePrefill(undefined);
  };

  const eliminarMutation = useMutation({
    mutationFn: (id: string) => movimientosApi.eliminar(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['movimientos'] });
      qc.invalidateQueries({ queryKey: ['profesionales-sede'] });
      qc.invalidateQueries({ queryKey: ['citas'] });
      toast.success('Movimiento eliminado · la agenda se actualizó');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleEliminar = async (mov: Movimiento) => {
    const prof = `${mov.profesional.nombres} ${mov.profesional.apellidos}`;
    let mensaje: string;
    try {
      const imp = await movimientosApi.impacto(mov.id);
      if (!imp.tienePredecesor) {
        mensaje = `⚠ ATENCIÓN: esta es la asignación BASE de ${prof}.\n\nAl eliminarla quedará SIN sede asignada y desaparecerá de la agenda (no hay una sede anterior a la que volver).\n\nSi solo quieres moverla a otra sede, usa "+ Nuevo movimiento".\n\n¿Eliminar de todas formas?`;
      } else {
        mensaje = `¿Eliminar este movimiento?\n\n${prof} volverá a ${imp.sedeAnteriorNombre ?? 'su sede anterior'} y su columna se quitará de ${mov.sede.nombre} en la agenda.`;
        if (imp.citasAfectadas > 0) {
          mensaje += `\n\n⚠ Hay ${imp.citasAfectadas} cita(s) de ${prof} en ${mov.sede.nombre} dentro del periodo. Revísalas o reprográmalas: esa sede dejará de tenerle asignación.`;
        }
      }
    } catch {
      mensaje = `¿Eliminar este movimiento? ${prof} volverá a su asignación anterior.`;
    }
    if (!confirm(mensaje)) return;
    eliminarMutation.mutate(mov.id);
  };

  // Filtro por nombre según la vista activa.
  const query = busqueda.toLowerCase().trim();
  const coincide = (m: Movimiento) =>
    !query || `${m.profesional.nombres} ${m.profesional.apellidos}`.toLowerCase().includes(query);

  // Tablero: unión de asignaciones activas + próximas (todas las activa:true de hoy en
  // adelante). Proyectamos a la fecha elegida sin pedir nada al backend.
  const todasActivas = (() => {
    const mapa = new Map<string, Movimiento>();
    [...(activosQ.data ?? []), ...(proximosQ.data ?? [])].forEach(m => mapa.set(m.id, m));
    return [...mapa.values()];
  })();
  const enFecha = (m: Movimiento) =>
    m.activa &&
    m.fechaInicio.slice(0, 10) <= fechaVista &&
    (!m.fechaFin || m.fechaFin.slice(0, 10) >= fechaVista);

  const tableroMovs = todasActivas.filter(enFecha).filter(coincide);
  // Cambios programados relativos a la fecha vista (arranca después del día elegido).
  const cambiosPorSede = todasActivas
    .filter(m => m.activa && m.fechaInicio.slice(0, 10) > fechaVista)
    .reduce<Record<string, number>>((acc, m) => {
      acc[m.sedeId] = (acc[m.sedeId] ?? 0) + 1;
      return acc;
    }, {});

  const proximos = (proximosQ.data ?? []).filter(coincide)
    .sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio));
  const historial = (historialQ.data ?? []).filter(coincide)
    .sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio));

  const cargando = vista === 'hoy' ? (activosQ.isLoading || proximosQ.isLoading)
    : vista === 'proximo' ? proximosQ.isLoading
    : historialQ.isLoading;

  const VISTAS: { id: Vista; label: string; count?: number }[] = [
    { id: 'hoy', label: 'Hoy' },
    { id: 'proximo', label: 'Próximos', count: proximosQ.data?.length },
    { id: 'historial', label: 'Historial' },
  ];

  const sedesActivas = (sedes ?? []).filter(s => s.activa);

  return (
    <div className="flex flex-col h-full bg-slate-50/50">
      {/* Header */}
      <div className="px-6 py-4 bg-white border-b border-slate-200 flex items-center justify-between gap-4 shrink-0">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-slate-900">Movimientos de personal</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Quién atiende en cada sede. Los cambios se reflejan al instante en la agenda.
          </p>
        </div>
        {canWrite && (
          <button onClick={() => abrirNuevo()} className="btn-primary btn-sm shrink-0">
            + Nuevo movimiento
          </button>
        )}
      </div>

      {/* Barra de control: cambio de vista + buscador */}
      <div className="px-6 py-3 bg-white border-b border-slate-200 flex flex-wrap items-center gap-3 shrink-0">
        <div className="inline-flex bg-slate-100 rounded-lg p-1 gap-1">
          {VISTAS.map(v => (
            <button
              key={v.id}
              onClick={() => setVista(v.id)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded-md transition-all',
                vista === v.id ? 'bg-white text-limablue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {v.label}
              {typeof v.count === 'number' && v.count > 0 && (
                <span className={cn('ml-1.5 text-xs', vista === v.id ? 'text-limablue-500' : 'text-slate-400')}>
                  {v.count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar podóloga..."
            className="input w-full pl-9 text-sm"
          />
          {busqueda && (
            <button
              onClick={() => setBusqueda('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              aria-label="Limpiar búsqueda"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Contenido */}
      <div className="flex-1 overflow-y-auto p-6">
        {cargando ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-limablue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : vista === 'hoy' ? (
          // ── Tablero por sede ──
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <NavegadorFecha fecha={fechaVista} hoy={hoyStr} onChange={setFechaVista} />
              {fechaVista !== hoyStr && (
                <p className="text-xs text-slate-500">
                  Proyección: así quedará la asignación de cada sede ese día.
                </p>
              )}
            </div>
            <div className="flex flex-col lg:flex-row gap-4 lg:overflow-x-auto pb-2">
              {sedesActivas.map(sede => (
                <SedeColumn
                  key={sede.id}
                  sede={sede}
                  movs={tableroMovs.filter(m => m.sedeId === sede.id)}
                  proximos={cambiosPorSede[sede.id] ?? 0}
                  canWrite={canWrite}
                  onNuevo={s => abrirNuevo(s.id)}
                  onEditar={abrirEditar}
                  onEliminar={handleEliminar}
                  onVerProximos={() => setVista('proximo')}
                />
              ))}
              {!sedesActivas.length && (
                <p className="text-sm text-slate-400 py-16 text-center w-full">No hay sedes activas.</p>
              )}
            </div>
          </div>
        ) : vista === 'proximo' ? (
          // ── Próximos ──
          proximos.length ? (
            <div className="grid gap-3 max-w-3xl">
              {proximos.map(m => (
                <MovimientoFila key={m.id} mov={m} canWrite={canWrite} onEditar={abrirEditar} onEliminar={handleEliminar} />
              ))}
            </div>
          ) : (
            <EstadoVacio
              emoji="📅"
              titulo={query ? `Sin resultados para "${busqueda}"` : 'No hay movimientos programados'}
              accion={canWrite && !query ? { label: '+ Programar movimiento', onClick: () => abrirNuevo() } : undefined}
            />
          )
        ) : (
          // ── Historial ──
          historial.length ? (
            <div className="grid gap-3 max-w-3xl">
              {historial.map(m => (
                <MovimientoFila key={m.id} mov={m} canWrite={canWrite} onEditar={abrirEditar} onEliminar={handleEliminar} atenuado />
              ))}
            </div>
          ) : (
            <EstadoVacio emoji="🗂" titulo={query ? `Sin resultados para "${busqueda}"` : 'Sin historial de movimientos'} />
          )
        )}
      </div>

      {modalAbierto && (
        <MovimientoModal onClose={cerrarModal} movimientoEditar={editando} prefillSedeId={sedePrefill} />
      )}
    </div>
  );
}

function EstadoVacio({ emoji, titulo, accion }: {
  emoji: string; titulo: string; accion?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-3xl mb-3">{emoji}</p>
      <p className="font-semibold text-slate-700">{titulo}</p>
      {accion && (
        <button onClick={accion.onClick} className="btn-primary btn-sm mt-4">{accion.label}</button>
      )}
    </div>
  );
}
