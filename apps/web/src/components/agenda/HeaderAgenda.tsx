import { format, addDays, subDays, isToday, nextSaturday, isSameDay, startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAgendaStore } from '../../stores/agendaStore';
import { horariosApi, type Sede } from '../../api';
import { ModalHorario } from './ModalHorario';

interface StatsDay { total: number; confirmadas: number; llegaron: number; noShows: number; completadas: number; ocupacion: number }

interface HeaderAgendaProps {
  sedes: Sede[];
  stats?: StatsDay;
  onExportar?: () => void;
  exportando?: boolean;
}

export function HeaderAgenda({ sedes, stats, onExportar, exportando }: HeaderAgendaProps) {
  const { sedeId, setSedeId, fecha, setFecha, fechaStr } = useAgendaStore();
  const [modalHorario, setModalHorario] = useState(false);

  const sedeActual = sedes.find(s => s.id === sedeId);

  const { data: horarioData } = useQuery({
    queryKey: ['horario', sedeId, fechaStr()],
    queryFn: () => horariosApi.efectivo(sedeId!, fechaStr()),
    enabled: !!sedeId,
  });

  const efectivo = horarioData?.efectivo;

  return (
    <>
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-4 flex-shrink-0">
        {/* Selector de sede */}
        <div className="flex items-center gap-1.5">
          {sedes.map(sede => (
            <button
              key={sede.id}
              onClick={() => setSedeId(sede.id)}
              data-testid={`sede-btn-${sede.id}`}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                sedeId === sede.id
                  ? 'text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
              style={sedeId === sede.id ? { backgroundColor: sede.color } : {}}
            >
              {sede.nombre}
            </button>
          ))}
        </div>

        <div className="w-px h-6 bg-slate-200" />

        {/* Navegación de fecha */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFecha(subDays(fecha, 1))}
            className="btn-icon btn-secondary"
            aria-label="Día anterior"
          >
            ‹
          </button>

          <button
            onClick={() => setFecha(addDays(fecha, 1))}
            className="btn-icon btn-secondary"
            aria-label="Día siguiente"
          >
            ›
          </button>

          <div className="w-px h-5 bg-slate-200" />

          {/* Atajos rápidos */}
          {(() => {
            const hoy = startOfDay(new Date());
            const manana = addDays(hoy, 1);
            const sabado = nextSaturday(hoy);
            const semana = addDays(hoy, 7);
            const fechaD = startOfDay(fecha);
            const atajos = [
              { label: 'Hoy',       destino: hoy },
              { label: 'Mañana',    destino: manana },
              { label: 'Sábado',    destino: sabado },
              { label: 'En 1 sem.', destino: semana },
            ];
            return atajos.map(({ label, destino }) => (
              <button
                key={label}
                onClick={() => setFecha(destino)}
                className={`btn btn-sm ${isSameDay(fechaD, destino) ? 'btn-primary' : 'btn-secondary'}`}
              >
                {label}
              </button>
            ));
          })()}

          <div className="w-px h-5 bg-slate-200" />

          <div className="text-sm font-semibold text-slate-800 min-w-[180px] text-center capitalize">
            {format(fecha, "EEEE d 'de' MMMM, yyyy", { locale: es })}
          </div>

          <input
            type="date"
            value={format(fecha, 'yyyy-MM-dd')}
            onChange={e => {
              const d = new Date(e.target.value + 'T12:00:00');
              if (!isNaN(d.getTime())) setFecha(d);
            }}
            className="input w-auto text-xs cursor-pointer"
            aria-label="Seleccionar fecha"
            data-testid="agenda-fecha-input"
          />
        </div>

        {/* Indicador de horario del día */}
        {sedeActual && efectivo && (
          <>
            <div className="w-px h-6 bg-slate-200" />
            <button
              onClick={() => setModalHorario(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg hover:bg-slate-100 transition-colors group"
              title="Ver y gestionar horarios"
            >
              {efectivo.abierto ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                  <span className="text-xs font-mono text-slate-700">
                    {efectivo.apertura} – {efectivo.cierre}
                  </span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
                  <span className="text-xs text-red-600 font-medium">Cerrado hoy</span>
                </>
              )}
              {efectivo.esExcepcion && (
                <span className="text-xxs px-1 py-0.5 bg-amber-100 text-amber-700 rounded-full font-semibold">exc</span>
              )}
              <svg className="w-3 h-3 text-slate-400 group-hover:text-slate-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          </>
        )}

        {/* Stats del día */}
        {stats && (
          <>
            <div className="w-px h-6 bg-slate-200" />
            <div className="flex items-center gap-4 text-xs text-slate-600">
              <span>
                <strong className="text-slate-900">{stats.total}</strong> citas
              </span>
              <span className="text-green-600">
                <strong>{stats.llegaron}</strong> llegaron
              </span>
              <span className="text-amber-600">
                <strong>{stats.completadas}</strong> completadas
              </span>
              <span className="text-red-500">
                <strong>{stats.noShows}</strong> no-shows
              </span>
              <span className="ml-2 inline-flex items-center gap-1">
                <div className="h-1.5 w-20 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-limablue-500 rounded-full transition-all"
                    style={{ width: `${stats.ocupacion}%` }}
                  />
                </div>
                <span className="text-limablue-700 font-medium">{stats.ocupacion}%</span>
              </span>
            </div>
          </>
        )}

        <div className="flex-1" />

        {/* Exportar XLSX */}
        {onExportar && (
          <button
            onClick={onExportar}
            disabled={exportando}
            title="Descargar Excel con todas las citas del día (todas las sedes y unidades)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors disabled:opacity-50"
          >
            {exportando ? (
              <span className="w-3.5 h-3.5 border-2 border-emerald-600/30 border-t-emerald-600 rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2" />
              </svg>
            )}
            Exportar Excel
          </button>
        )}

        {/* Atajos */}
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <kbd className="px-1.5 py-0.5 bg-slate-100 rounded border border-slate-300 text-slate-500">N</kbd>
          <span>nueva cita</span>
          <kbd className="px-1.5 py-0.5 bg-slate-100 rounded border border-slate-300 text-slate-500">⌘K</kbd>
          <span>buscar</span>
        </div>
      </header>

      {modalHorario && sedeActual && (
        <ModalHorario
          sedeId={sedeActual.id}
          sedeName={sedeActual.nombre}
          onClose={() => setModalHorario(false)}
        />
      )}
    </>
  );
}
