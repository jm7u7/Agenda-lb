import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { notificacionesApi } from '../api/notificaciones';
import { useNotificacionesStore } from '../stores/notificacionesStore';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const login = useAuthStore(s => s.login);
  const setPendientes = useNotificacionesStore(s => s.setPendientes);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      // Fetch notificaciones y guardar en store global antes de navegar.
      // El banner se mostrará desde Layout, evitando la race condition con el
      // guard de ruta que redirige en cuanto el token está disponible.
      try {
        const activas = await notificacionesApi.getActivas();
        if (activas.length > 0) setPendientes(activas);
      } catch {
        // Si falla, seguir igualmente sin bloquear acceso
      }
      navigate('/', { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setError('');
  };

  return (
    <div className="min-h-screen bg-[#0a1628] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Tarjeta principal */}
        <div className="bg-[#111e35] rounded-2xl shadow-2xl overflow-hidden">

          {/* Header azul oscuro — zona del logo */}
          <div className="bg-[#003366] px-8 pt-8 pb-6">
            <div className="flex justify-center items-center">
              <img src="/logo-limablue.svg" alt="Limablue Agenda" className="h-24 w-auto" />
            </div>
            <p className="text-center text-slate-400 text-sm mt-4">
              Ingresa tus credenciales para continuar
            </p>
          </div>

          {/* Formulario */}
          <form onSubmit={handleSubmit} className="px-8 py-6 space-y-4">

            {/* Email */}
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-base select-none">✉</span>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Correo electrónico"
                required
                autoComplete="email"
                autoFocus
                className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              />
            </div>

            {/* Contraseña */}
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-base select-none">🔒</span>
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Contraseña"
                required
                autoComplete="current-password"
                className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-14 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPwd(!showPwd)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs transition-colors"
              >
                {showPwd ? 'Ocultar' : 'Ver'}
              </button>
            </div>

            {/* Error inline */}
            {error && (
              <p className="text-red-400 text-sm text-center bg-red-500/10 border border-red-500/20 rounded-lg py-2 px-3">
                {error}
              </p>
            )}

            {/* Botón submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Ingresando...
                </>
              ) : 'Ingresar'}
            </button>
          </form>

          {/* Cuentas de demo */}
          <div className="px-8 pb-6 pt-0">
            <div className="border-t border-white/5 pt-4">
              <p className="text-xs font-medium text-slate-500 mb-2">Acceso rápido (demo):</p>
              <div className="space-y-1">
                {[
                  { label: 'Admin', email: 'admin@limablue.pe', pass: 'Admin1234!' },
                  { label: 'Coordinadora', email: 'coordinadora@limablue.pe', pass: 'Admin1234!' },
                  { label: 'Recepción Los Olivos', email: 'recepcion.losolivos@limablue.pe', pass: 'Recepcion2025!' },
                ].map(c => (
                  <button
                    key={c.email}
                    type="button"
                    onClick={() => fillDemo(c.email, c.pass)}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-colors"
                  >
                    <span className="font-medium text-slate-300">{c.label}</span>
                    <span className="ml-2 text-slate-500">{c.email}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <p className="text-center text-slate-600 text-xs mt-6">
          Limablue Agenda © {new Date().getFullYear()} · Lima, Perú
        </p>
      </div>
    </div>
  );
}
