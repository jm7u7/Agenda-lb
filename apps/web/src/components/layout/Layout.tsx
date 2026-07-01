import { Outlet, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useNotificacionesStore } from '../../stores/notificacionesStore';
import { Sidebar } from './Sidebar';
import { CommandPalette } from '../agenda/CommandPalette';
import { NotificacionLoginBanner } from '../NotificacionLoginBanner';

export function Layout() {
  const token = useAuthStore(s => s.token);
  const navigate = useNavigate();
  const { pendientes, limpiar } = useNotificacionesStore();

  useEffect(() => {
    if (!token) navigate('/login', { replace: true });
  }, [token, navigate]);

  if (!token) return null;

  return (
    <div className="flex h-screen bg-slate-50" style={{ flexDirection: 'column' }}>
      {/* Banner de notificaciones post-login */}
      {pendientes.length > 0 && (
        <NotificacionLoginBanner
          notificaciones={pendientes}
          onCerrar={limpiar}
        />
      )}

      <div className="flex flex-1 overflow-hidden min-h-0">
        <Sidebar />
        <main className="flex-1 overflow-hidden flex flex-col min-w-0">
          <Outlet />
        </main>
      </div>
      <footer className="flex-shrink-0 bg-[#0a1628] border-t border-white/5 py-1.5 text-center">
        <span className="text-xs text-slate-500">Sistema desarrollado por Daniel Doy para Limablue Corp.</span>
      </footer>
      <CommandPalette />
    </div>
  );
}
