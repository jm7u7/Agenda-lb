import { Link, useLocation } from 'react-router-dom';
import { cn } from '../../utils/cn';
import { useAuthStore } from '../../stores/authStore';

// El menú se guía por PERMISOS del rol (configurables en Administración → Roles).
const navItems = [
  { to: '/', label: 'Agenda', icon: '📅', permiso: 'agenda.ver' },
  { to: '/pacientes', label: 'Pacientes', icon: '👤', permiso: 'pacientes.ver' },
  { to: '/herramientas', label: 'Herramientas', icon: '🛠️', permiso: ['herramientas.operativas', 'herramientas.estrategicas'] },
  { to: '/movimientos', label: 'Movimientos', icon: '⇄', permiso: 'movimientos.ver' },
  { to: '/admin', label: 'Administración', icon: '⚙️', permiso: 'admin.ver' },
  { to: '/admin/usuarios', label: 'Usuarios', icon: '👥', permiso: 'usuarios.ver' },
  { to: '/admin/roles', label: 'Roles', icon: '🔑', permiso: 'roles.editar' },
  { to: '/admin/notificaciones', label: 'Notificaciones', icon: '🔔', permiso: 'notificaciones.ver' },
  { to: '/analytics', label: 'Analytics', icon: '📊', permiso: 'analytics.ver' },
];

export function Sidebar() {
  const location = useLocation();
  const { usuario, logout } = useAuthStore();

  const perms = usuario?.permisos ?? [];
  const items = navItems.filter(n => Array.isArray(n.permiso) ? n.permiso.some(p => perms.includes(p)) : perms.includes(n.permiso));

  return (
    <nav className="w-16 bg-limablue-900 flex flex-col items-center py-3 gap-1 flex-shrink-0">
      {/* Logo */}
      <div className="mb-4">
        <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center p-1.5" title="Limablue Agenda">
          <img src="/logo-mark.svg" alt="Limablue" className="w-full h-full object-contain" />
        </div>
      </div>

      {/* Nav */}
      {items.map(item => {
        const active = item.to === '/'
          ? location.pathname === '/'
          : location.pathname === item.to || (item.to !== '/admin' && location.pathname.startsWith(item.to));
        return (
          <Link
            key={item.to}
            to={item.to}
            title={item.label}
            className={cn(
              'w-11 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all',
              active
                ? 'bg-limablue-600 text-white shadow-lg shadow-limablue-900/50'
                : 'text-limablue-300 hover:bg-limablue-800 hover:text-white'
            )}
          >
            <span className="text-lg leading-none">{item.icon}</span>
            <span className="text-xxs leading-none">{item.label.split(' ')[0]}</span>
          </Link>
        );
      })}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Ayuda */}
      <button
        title="Atajos de teclado (?)"
        onClick={() => {
          const ev = new KeyboardEvent('keydown', { key: '?', bubbles: true });
          document.dispatchEvent(ev);
        }}
        className="w-11 h-11 rounded-xl flex items-center justify-center text-limablue-400 hover:bg-limablue-800 hover:text-white transition-all"
      >
        <span className="text-lg">?</span>
      </button>

      {/* Usuario */}
      <button
        onClick={logout}
        title={`${usuario?.nombre} — Cerrar sesión`}
        className="w-11 h-11 rounded-xl bg-limablue-800 flex items-center justify-center text-white hover:bg-red-500 transition-all"
      >
        <span className="text-sm font-bold">
          {usuario?.nombre.split(' ').map(n => n[0]).slice(0, 2).join('')}
        </span>
      </button>
    </nav>
  );
}
