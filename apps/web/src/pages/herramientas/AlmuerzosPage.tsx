import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { sedesApi } from '../../api';
import { almuerzosApi, type BloqueoAlmuerzo } from '../../api/almuerzos';
import { profesionalesApi } from '../../api';
import { TURNOS_ALMUERZO } from '@limablue/shared';
import { cn } from '../../utils/cn';

const NOMBRE_PAZ_SOLDAN = 'Paz Soldán';

// ── Tipos internos ────────────────────────────────────────────────────────────
interface ProfesionalConAlmuerzo {
  id: string;
  nombres: string;
  apellidos: string;
  tipo: string;
  colorAvatar: string;
  almuerzo: BloqueoAlmuerzo | null;
}

// ── Popover de asignación ─────────────────────────────────────────────────────
function PopoverAsignar({
  profesional,
  sedeId,
  onClose,
}: {
  profesional: ProfesionalConAlmuerzo;
  sedeId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [turnoSel, setTurnoSel] = useState<string>('');

  const crearMutation = useMutation({
    mutationFn: () =>
      almuerzosApi.crear({ profesionalId: profesional.id, sedeId, horaInicio: turnoSel }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['almuerzos', sedeId] });
      const turno = TURNOS_ALMUERZO.find(t => t.horaInicio === turnoSel);
      toast.success(
        `Almuerzo de ${profesional.nombres.split(' ')[0]} ${profesional.apellidos.split(' ')[0]} registrado: ${turno?.label}`,
      );
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-white border border-slate-200 rounded-xl shadow-xl p-3">
      <p className="text-xs font-semibold text-slate-700 mb-2">Turno de almuerzo</p>
      <div className="space-y-1.5 mb-3">
        {TURNOS_ALMUERZO.map(t => (
          <button
            key={t.id}
            onClick={() => setTurnoSel(t.horaInicio)}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-all',
              turnoSel === t.horaInicio
                ? 'bg-amber-50 border-amber-400 text-amber-800 font-semibold'
                : 'border-slate-200 text-slate-600 hover:border-amber-300 hover:bg-amber-50/50',
            )}
          >
            <span
              className={cn(
                'w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0',
                turnoSel === t.horaInicio ? 'border-amber-500' : 'border-slate-300',
              )}
            >
              {turnoSel === t.horaInicio && (
                <span className="w-2 h-2 rounded-full bg-amber-500" />
              )}
            </span>
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
          Cancelar
        </button>
        <button
          onClick={() => crearMutation.mutate()}
          disabled={!turnoSel || crearMutation.isPending}
          className="flex-1 py-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-40 rounded-lg transition-colors"
        >
          {crearMutation.isPending ? '…' : 'Confirmar'}
        </button>
      </div>
    </div>
  );
}

// ── Modal de confirmación de eliminación ──────────────────────────────────────
function ModalEliminar({
  bloqueo,
  sedeName,
  onConfirm,
  onClose,
  pending,
}: {
  bloqueo: BloqueoAlmuerzo;
  sedeName: string;
  onConfirm: () => void;
  onClose: () => void;
  pending: boolean;
}) {
  const turno = TURNOS_ALMUERZO.find(t => t.horaInicio === bloqueo.horaInicio);
  const nombre = `${bloqueo.profesional.nombres.split(' ')[0]} ${bloqueo.profesional.apellidos.split(' ')[0]}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
        <h3 className="text-base font-bold text-slate-900 mb-1">Eliminar horario de almuerzo</h3>
        <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-200 mb-4">
          <p className="font-semibold text-slate-800 text-sm">{nombre}</p>
          <p className="text-xs text-slate-500 mt-0.5">{turno?.label} · {sedeName}</p>
        </div>
        <p className="text-sm text-slate-600 mb-5">
          Se eliminará de todos los días restantes de su estancia en esta sede. Podrás volver a crearlo en cualquier momento.
        </p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="flex-1 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 rounded-xl transition-colors"
          >
            {pending ? 'Eliminando…' : 'Sí, eliminar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Fila de profesional ───────────────────────────────────────────────────────
function FilaProfesional({
  prof,
  sedeId,
}: {
  prof: ProfesionalConAlmuerzo;
  sedeId: string;
}) {
  const qc = useQueryClient();
  const [mostrando, setMostrando] = useState(false);
  const [confirmando, setConfirmando] = useState<BloqueoAlmuerzo | null>(null);
  const iniciales = `${prof.nombres[0] ?? ''}${prof.apellidos[0] ?? ''}`;

  const eliminarMutation = useMutation({
    mutationFn: (id: string) => almuerzosApi.eliminar(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['almuerzos', sedeId] });
      toast.success('Horario de almuerzo eliminado.');
      setConfirmando(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const turno = prof.almuerzo ? TURNOS_ALMUERZO.find(t => t.horaInicio === prof.almuerzo!.horaInicio) : null;
  const tipoLabel = prof.tipo === 'podologa' ? 'Podóloga' : 'Fisioterapeuta';

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
        {/* Avatar */}
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
          style={{ backgroundColor: prof.colorAvatar }}
        >
          {iniciales}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900">
            {prof.nombres.split(' ')[0]} {prof.apellidos.split(' ')[0]} · <span className="font-normal text-slate-500">{tipoLabel}</span>
          </p>
          {prof.almuerzo ? (
            <div className="mt-0.5 space-y-0.5">
              <p className="text-xs text-amber-700 font-medium flex items-center gap-1">
                🍽 Almuerzo&nbsp;
                <span className="font-semibold">{turno?.label}</span>
              </p>
              <p className="text-xs text-slate-400">
                Registrado por {prof.almuerzo.creadoPorUsuario?.nombre ?? '—'} el{' '}
                {format(new Date(prof.almuerzo.creadoEn), "d 'de' MMM yyyy", { locale: es })}
              </p>
            </div>
          ) : (
            <p className="text-xs text-slate-400 mt-0.5">Sin horario de almuerzo</p>
          )}
        </div>

        {/* Acción */}
        {prof.almuerzo ? (
          <button
            onClick={() => setConfirmando(prof.almuerzo)}
            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
            title="Eliminar almuerzo"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        ) : (
          <div className="relative">
            <button
              onClick={() => setMostrando(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors"
            >
              + Asignar
            </button>
            {mostrando && (
              <PopoverAsignar
                profesional={prof}
                sedeId={sedeId}
                onClose={() => setMostrando(false)}
              />
            )}
          </div>
        )}
      </div>

      {confirmando && (
        <ModalEliminar
          bloqueo={confirmando}
          sedeName=""
          onConfirm={() => eliminarMutation.mutate(confirmando.id)}
          onClose={() => setConfirmando(null)}
          pending={eliminarMutation.isPending}
        />
      )}
    </>
  );
}

// ── Panel de resumen de distribución ─────────────────────────────────────────
function PanelDistribucion({ bloqueos, sedeName }: { bloqueos: BloqueoAlmuerzo[]; sedeName: string }) {
  const conteos = TURNOS_ALMUERZO.map(t => ({
    ...t,
    count: bloqueos.filter(b => b.horaInicio === t.horaInicio).length,
  }));
  const max = Math.max(...conteos.map(c => c.count), 1);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
        Distribución de almuerzos — {sedeName}
      </p>
      <div className="space-y-2.5">
        {conteos.map(c => (
          <div key={c.id} className="flex items-center gap-3">
            <span className="text-xs font-mono text-slate-500 w-20 shrink-0">{c.label}</span>
            <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
              <div
                className="h-full bg-amber-400 rounded-full transition-all duration-300"
                style={{ width: `${(c.count / max) * 100}%` }}
              />
            </div>
            <span className="text-xs font-semibold text-slate-700 w-20 text-right shrink-0">
              {c.count} {c.count === 1 ? 'profesional' : 'profesionales'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export function AlmuerzosPage() {
  const [sedeSelId, setSedeSelId] = useState<string>('');

  const { data: sedes = [] } = useQuery({
    queryKey: ['sedes'],
    queryFn: sedesApi.listar,
  });

  // Auto-seleccionar primera sede
  const sedeId = sedeSelId || sedes[0]?.id || '';
  const sedeActual = sedes.find(s => s.id === sedeId);
  const esPazSoldan = sedeActual?.nombre === NOMBRE_PAZ_SOLDAN;

  // Almuerzos de la sede
  const { data: bloqueos = [], isLoading: loadingBloqueos } = useQuery({
    queryKey: ['almuerzos', sedeId],
    queryFn: () => almuerzosApi.listar(sedeId),
    enabled: !!sedeId,
  });

  // Profesionales de la sede (filtramos al renderizar según el tipo/sede)
  const { data: profesionales = [], isLoading: loadingProfs } = useQuery({
    queryKey: ['profesionales-sede', sedeId],
    queryFn: () => profesionalesApi.listar({ sedeId, activo: true }),
    enabled: !!sedeId,
  });

  // Filtrar: podólogas en todas las sedes; fisioterapeutas solo en Paz Soldán
  const profesionalesFiltrados = profesionales.filter(
    p => p.tipo === 'podologa' || (p.tipo === 'fisioterapeuta' && esPazSoldan),
  );

  // Cruzar profesionales con sus almuerzos
  const profesionalesConAlmuerzo: ProfesionalConAlmuerzo[] = profesionalesFiltrados.map(p => ({
    id: p.id,
    nombres: p.nombres,
    apellidos: p.apellidos,
    tipo: p.tipo,
    colorAvatar: p.colorAvatar,
    almuerzo: bloqueos.find(b => b.profesionalId === p.id) ?? null,
  }));

  const loading = loadingBloqueos || loadingProfs;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3 sticky top-0 z-10">
        <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center shrink-0">
          <span className="text-white text-lg">🍽</span>
        </div>
        <div>
          <h1 className="text-base font-bold text-slate-900">Horarios de almuerzo</h1>
          <p className="text-xs text-slate-500">
            Bloqueo de 1 hora fija en la agenda de cada profesional
          </p>
        </div>
      </div>

      {/* Tabs de sede */}
      <div className="bg-white border-b border-slate-200 px-6 flex gap-0 overflow-x-auto">
        {sedes.map(s => (
          <button
            key={s.id}
            onClick={() => setSedeSelId(s.id)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap',
              sedeId === s.id
                ? 'border-amber-500 text-amber-700'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
            )}
          >
            {s.nombre}
          </button>
        ))}
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : profesionalesFiltrados.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <p className="text-2xl mb-2">🍽</p>
            <p className="text-sm">No hay profesionales elegibles en esta sede</p>
          </div>
        ) : (
          <>
            {/* Lista de profesionales */}
            <div className="space-y-2">
              {profesionalesConAlmuerzo.map(prof => (
                <FilaProfesional key={prof.id} prof={prof} sedeId={sedeId} />
              ))}
            </div>

            {/* Panel de distribución */}
            {bloqueos.length > 0 && (
              <PanelDistribucion bloqueos={bloqueos} sedeName={sedeActual?.nombre ?? ''} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
