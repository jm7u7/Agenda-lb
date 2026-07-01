import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { cn } from '../utils/cn';
import { movimientosApi, MOTIVO_LABELS, type Movimiento } from '../api/movimientos';
import { MovimientoModal } from '../components/movimientos/MovimientoModal';
import { useAuthStore } from '../stores/authStore';

type Tab = 'activo' | 'proximo' | 'historial';

const TAB_LABELS: Record<Tab, string> = {
  activo: 'Activos hoy',
  proximo: 'Próximos',
  historial: 'Historial',
};

function BadgeMotivo({ motivo }: { motivo: string }) {
  const label = MOTIVO_LABELS[motivo as keyof typeof MOTIVO_LABELS] ?? motivo;
  const colores: Record<string, string> = {
    VACACIONES: 'bg-sky-100 text-sky-700',
    CAMBIO_POR_TIEMPO: 'bg-violet-100 text-violet-700',
    CERCANIA_A_CASA: 'bg-emerald-100 text-emerald-700',
    PROBLEMAS_INTERNOS: 'bg-red-100 text-red-700',
    COBERTURA_EMERGENCIA: 'bg-amber-100 text-amber-700',
    OTRO: 'bg-slate-100 text-slate-600',
  };
  return (
    <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full', colores[motivo] ?? 'bg-slate-100 text-slate-600')}>
      {label}
    </span>
  );
}

function TarjetaMovimiento({
  mov,
  onEditar,
  onEliminar,
  canWrite,
}: {
  mov: Movimiento;
  onEditar: (m: Movimiento) => void;
  onEliminar: (m: Movimiento) => void;
  canWrite: boolean;
}) {
  const hoy = new Date();
  // Solo la parte de fecha (YYYY-MM-DD): el campo es @db.Date (medianoche UTC); parsearlo con
  // hora desfasa −1 día en zonas detrás de UTC (Lima −5) tanto al mostrar como al contar días.
  const inicio = parseISO(mov.fechaInicio.slice(0, 10));
  const diasParaInicio = differenceInCalendarDays(inicio, hoy);
  const estaActivo = mov.estadoCalc === 'activo';
  const esProximo = mov.estadoCalc === 'proximo';
  // Se puede eliminar un movimiento activo o futuro (no los del historial ya finalizados).
  const puedeEliminar = canWrite && mov.estadoCalc !== 'historial';

  const rangoFechas = (() => {
    const ini = format(inicio, "d 'de' MMM", { locale: es });
    if (!mov.fechaFin) return `${ini} → indefinido`;
    const fin = format(parseISO(mov.fechaFin.slice(0, 10)), "d 'de' MMM", { locale: es });
    return `${ini} → ${fin}`;
  })();

  return (
    <div className={cn(
      'relative bg-white rounded-xl border p-4 transition-all hover:shadow-md',
      estaActivo ? 'border-l-4 border-l-limablue-500 border-slate-200' :
      esProximo && diasParaInicio <= 7 ? 'border-l-4 border-l-amber-400 border-slate-200' :
      'border-slate-200',
    )}>
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <span
          className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
          style={{ backgroundColor: mov.profesional.colorAvatar }}
        >
          {mov.profesional.nombres[0]}{mov.profesional.apellidos[0]}
        </span>

        {/* Contenido */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-sm text-slate-900 leading-tight">
                {mov.profesional.nombres} {mov.profesional.apellidos}
              </p>
              {/* Sede destino con color */}
              <div className="flex items-center gap-1.5 mt-1">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: mov.sede.color }} />
                <span className="text-xs font-medium text-slate-700">{mov.sede.nombre}</span>
              </div>
            </div>
            <BadgeMotivo motivo={mov.motivo} />
          </div>

          {/* Rango de fechas */}
          <p className="text-xs text-slate-500 mt-1.5">{rangoFechas}</p>

          {/* Reemplaza a */}
          {mov.reemplazaProfesional && (
            <p className="text-xs text-slate-500 mt-0.5">
              Reemplaza a {mov.reemplazaProfesional.nombres} {mov.reemplazaProfesional.apellidos}
            </p>
          )}

          {/* Notas */}
          {mov.notas && (
            <p className="text-xs text-slate-400 mt-1 italic">{mov.notas}</p>
          )}

          {/* Estado calc chip */}
          {esProximo && diasParaInicio <= 7 && (
            <p className="text-[10px] font-semibold text-amber-600 mt-1.5">
              Comienza en {diasParaInicio === 0 ? 'hoy' : diasParaInicio === 1 ? '1 día' : `${diasParaInicio} días`}
            </p>
          )}
        </div>
      </div>

      {/* Acciones */}
      {canWrite && (
        <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
          <button
            onClick={() => onEditar(mov)}
            className="text-xs text-slate-500 hover:text-limablue-600 font-medium transition-colors"
          >
            Editar
          </button>
          {puedeEliminar && (
            <button
              onClick={() => onEliminar(mov)}
              className="text-xs text-slate-400 hover:text-red-500 font-medium transition-colors ml-auto"
            >
              Eliminar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function MovimientosPage() {
  const [tab, setTab] = useState<Tab>('activo');
  const [busqueda, setBusqueda] = useState('');
  const [modalAbierto, setModalAbierto] = useState(false);
  const [editando, setEditando] = useState<Movimiento | null>(null);
  const qc = useQueryClient();
  const { usuario } = useAuthStore();
  const canWrite = usuario?.rol === 'admin' || usuario?.rol === 'coordinadora_sedes';

  const { data: movimientos, isLoading } = useQuery({
    queryKey: ['movimientos', tab],
    queryFn: () => movimientosApi.listar({ estado: tab }),
  });

  const eliminarMutation = useMutation({
    mutationFn: (id: string) => movimientosApi.eliminar(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['movimientos'] });
      // Refresca también la agenda (columnas y disponibilidad) por si está abierta.
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
        // No hay sede previa que restaurar → es la asignación BASE de la podóloga.
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Movimientos de personal</h1>
          <p className="text-sm text-slate-500 mt-0.5">Gestiona la asignación de podólogas a cada sede</p>
        </div>
        {canWrite && (
          <button
            onClick={() => { setEditando(null); setModalAbierto(true); }}
            className="btn-primary btn-sm"
          >
            + Nuevo movimiento
          </button>
        )}
      </div>

      {/* Aviso informativo */}
      <div className="px-6 py-2 bg-limablue-50 border-b border-limablue-100">
        <p className="text-xs text-limablue-700">
          <span className="font-semibold">Fuente de verdad:</span> Los cambios aquí se reflejan automáticamente en la agenda de cada sede sin pasos adicionales.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 bg-white px-6 shrink-0">
        {(Object.keys(TAB_LABELS) as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-all',
              tab === t
                ? 'border-limablue-600 text-limablue-700'
                : 'border-transparent text-slate-500 hover:text-slate-700',
            )}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Buscador */}
        {!isLoading && !!movimientos?.length && (
          <div className="relative max-w-2xl mb-4">
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
              >
                ✕
              </button>
            )}
          </div>
        )}

        {(() => {
          const query = busqueda.toLowerCase().trim();
          const filtrados = query
            ? (movimientos ?? []).filter(m =>
                `${m.profesional.nombres} ${m.profesional.apellidos}`.toLowerCase().includes(query)
              )
            : (movimientos ?? []);

          if (isLoading) return (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-2 border-limablue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          );

          if (!movimientos?.length) return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-3xl mb-3">🗂</p>
              <p className="font-semibold text-slate-700">
                {tab === 'activo' ? 'No hay asignaciones activas hoy' :
                 tab === 'proximo' ? 'No hay movimientos próximos' :
                 'Sin historial de movimientos'}
              </p>
              {canWrite && tab !== 'historial' && (
                <button
                  onClick={() => { setEditando(null); setModalAbierto(true); }}
                  className="btn-primary btn-sm mt-4"
                >
                  + Crear movimiento
                </button>
              )}
            </div>
          );

          if (!filtrados.length) return (
            <div className="flex flex-col items-center justify-center py-12 text-center max-w-2xl">
              <p className="text-2xl mb-2">🔍</p>
              <p className="font-semibold text-slate-700">Sin resultados para "{busqueda}"</p>
              <p className="text-sm text-slate-400 mt-1">Intenta con otro nombre</p>
              <button onClick={() => setBusqueda('')} className="text-sm text-limablue-600 hover:underline mt-2">Limpiar búsqueda</button>
            </div>
          );

          return (
            <div className="grid gap-3 max-w-2xl">
              {filtrados.map(mov => (
                <TarjetaMovimiento
                  key={mov.id}
                  mov={mov}
                  canWrite={canWrite}
                  onEditar={(m) => { setEditando(m); setModalAbierto(true); }}
                  onEliminar={handleEliminar}
                />
              ))}
            </div>
          );
        })()}
      </div>

      {/* Modal */}
      {modalAbierto && (
        <MovimientoModal
          onClose={() => { setModalAbierto(false); setEditando(null); }}
          movimientoEditar={editando}
        />
      )}
    </div>
  );
}
