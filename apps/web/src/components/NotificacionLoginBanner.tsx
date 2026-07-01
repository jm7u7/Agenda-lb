import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { notificacionesApi, type NotificacionActiva } from '../api/notificaciones';

interface Props {
  notificaciones: NotificacionActiva[];
  onCerrar: () => void;
}

export function NotificacionLoginBanner({ notificaciones, onCerrar }: Props) {
  const [cerrando, setCerrando] = useState(false);

  const handleCerrar = async () => {
    if (cerrando) return;
    setCerrando(true);
    try {
      await Promise.all(notificaciones.map(n => notificacionesApi.marcarVista(n.id)));
    } catch {
      // silencioso — no bloquear acceso por error de red
    }
    onCerrar();
  };

  const formatFecha = (iso: string) =>
    format(parseISO(iso), "EEE d MMM", { locale: es });

  return (
    <>
      {/* Backdrop — no cierra con click */}
      <div className="fixed inset-0 bg-black/50 z-50 backdrop-blur-sm" />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-white rounded-2xl shadow-2xl w-full max-w-[480px] pointer-events-auto"
          style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">📢</span>
              <h2 className="font-bold text-slate-900 text-base">Avisos de Limablue</h2>
            </div>
            <button
              onClick={handleCerrar}
              disabled={cerrando}
              className="text-slate-400 hover:text-slate-600 transition-colors text-xl leading-none disabled:opacity-50"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>

          {/* Cuerpo con scroll si hay muchos mensajes */}
          <div
            className="overflow-y-auto px-6 py-5 space-y-5"
            style={{ maxHeight: '400px' }}
          >
            {notificaciones.map((n, i) => (
              <div key={n.id}>
                {i > 0 && <hr className="border-slate-100 mb-5" />}
                <p
                  className="text-slate-800 leading-relaxed"
                  style={{ fontSize: '15px', lineHeight: '1.6' }}
                >
                  {n.mensaje}
                </p>
                <p className="text-xs text-slate-400 mt-2">
                  Publicado por{' '}
                  <span className="font-medium text-slate-500">{n.autor.nombre}</span>
                  {' · '}
                  vence el{' '}
                  <span className="font-medium text-slate-500">{formatFecha(n.activaHasta)}</span>
                  {!n.todasLasSedes && n.sedes.length > 0 && (
                    <span className="ml-1 text-slate-400">
                      · {n.sedes.map(s => s.nombre).join(', ')}
                    </span>
                  )}
                </p>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-slate-100 shrink-0">
            <button
              onClick={handleCerrar}
              disabled={cerrando}
              className="w-full bg-limablue-600 hover:bg-limablue-700 active:bg-limablue-800 text-white font-semibold py-2.5 px-4 rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {cerrando ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Guardando…
                </>
              ) : (
                <>Entendido →</>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
