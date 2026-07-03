import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { notificacionesApi } from '../api/notificaciones';
import { useNotificacionesStore } from '../stores/notificacionesStore';

// Logo del login: pegar el archivo en apps/web/public/logo-login.png
// Si no existe, cae al logo actual (logo-limablue.svg) sin romper la página.
const LOGO_SRC = '/logo-login.png';
const LOGO_FALLBACK = '/logo-limablue.svg';

function useRelojLima() {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const hora = ahora.toLocaleTimeString('es-PE', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const fecha = ahora.toLocaleDateString('es-PE', {
    timeZone: 'America/Lima',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
  return { hora, fecha };
}

const CUENTAS_DEMO = [
  { label: 'Admin', email: 'admin@limablue.pe', pass: 'Admin1234!' },
  { label: 'Coordinadora', email: 'coordinadora@limablue.pe', pass: 'Admin1234!' },
  { label: 'Recepción Los Olivos', email: 'recepcion.losolivos@limablue.pe', pass: 'Recepcion2025!' },
];

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const login = useAuthStore(s => s.login);
  const setPendientes = useNotificacionesStore(s => s.setPendientes);
  const navigate = useNavigate();
  const { hora, fecha } = useRelojLima();

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
    <div className="relative min-h-screen overflow-hidden bg-[#030B16] flex items-center justify-center p-4">
      <style>{`
        @keyframes lb-sweep {
          0%   { transform: translateY(-10vh); opacity: 0; }
          15%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { transform: translateY(110vh); opacity: 0; }
        }
        @keyframes lb-rise {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes lb-glow {
          0%, 100% { opacity: .45; }
          50%      { opacity: .8; }
        }
        .lb-rise { animation: lb-rise .6s cubic-bezier(.22,1,.36,1) both; }
        @media (prefers-reduced-motion: reduce) {
          .lb-sweep, .lb-glow-pulse { display: none; }
          .lb-rise { animation: none; }
        }
      `}</style>

      {/* Fondo: rejilla técnica + resplandores */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(62,160,240,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(62,160,240,0.06) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(ellipse 80% 70% at 50% 45%, black 30%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 70% at 50% 45%, black 30%, transparent 100%)',
        }}
      />
      <div
        aria-hidden
        className="lb-glow-pulse absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 46% 34% at 50% 34%, rgba(46,124,246,0.18), transparent 70%), radial-gradient(ellipse 30% 24% at 78% 78%, rgba(62,224,240,0.08), transparent 70%)',
          animation: 'lb-glow 7s ease-in-out infinite',
        }}
      />
      {/* Línea de escaneo vertical */}
      <div
        aria-hidden
        className="lb-sweep absolute left-0 right-0 h-px"
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(62,224,240,0.35) 50%, transparent)',
          animation: 'lb-sweep 9s linear infinite',
        }}
      />

      <div className="relative w-full max-w-md lb-rise">
        {/* Marcos de esquina tipo HUD */}
        <span aria-hidden className="absolute -top-2 -left-2 w-6 h-6 border-t-2 border-l-2 border-cyan-400/60 rounded-tl-sm" />
        <span aria-hidden className="absolute -top-2 -right-2 w-6 h-6 border-t-2 border-r-2 border-cyan-400/60 rounded-tr-sm" />
        <span aria-hidden className="absolute -bottom-2 -left-2 w-6 h-6 border-b-2 border-l-2 border-cyan-400/60 rounded-bl-sm" />
        <span aria-hidden className="absolute -bottom-2 -right-2 w-6 h-6 border-b-2 border-r-2 border-cyan-400/60 rounded-br-sm" />

        <div className="bg-[#081426]/80 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-[0_0_60px_-15px_rgba(46,124,246,0.45)]">

          {/* Barra de estado superior */}
          <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/10 bg-white/[0.03] font-mono text-[11px] tracking-widest text-cyan-300/80 uppercase">
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />
              Sistema de agenda
            </span>
            <span className="tabular-nums text-slate-400">{fecha} · {hora}</span>
          </div>

          {/* Logo */}
          <div className="px-8 pt-8 pb-6 text-center">
            <div className="relative inline-block">
              <div
                aria-hidden
                className="absolute inset-0 -m-6 rounded-full"
                style={{ background: 'radial-gradient(circle, rgba(62,224,240,0.18), transparent 70%)' }}
              />
              <img
                src={LOGO_SRC}
                onError={e => {
                  const img = e.currentTarget;
                  if (!img.dataset.fallback) {
                    img.dataset.fallback = '1';
                    img.src = LOGO_FALLBACK;
                  }
                }}
                alt="Limablue Agenda"
                className="relative h-48 w-auto mx-auto"
              />
            </div>
            <p className="mt-5 font-mono text-[11px] tracking-[0.3em] uppercase text-slate-500">
              Acceso al sistema
            </p>
          </div>

          {/* Formulario */}
          <form onSubmit={handleSubmit} className="px-8 pb-6 space-y-4">
            <div className="relative group">
              <svg aria-hidden className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-cyan-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Correo electrónico"
                required
                autoComplete="email"
                autoFocus
                className="w-full bg-white/[0.04] border border-white/10 rounded-lg pl-10 pr-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-cyan-400/60 focus:shadow-[0_0_0_1px_rgba(62,224,240,0.4),0_0_20px_-6px_rgba(62,224,240,0.5)] transition-all"
              />
            </div>

            <div className="relative group">
              <svg aria-hidden className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-cyan-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Contraseña"
                required
                autoComplete="current-password"
                className="w-full bg-white/[0.04] border border-white/10 rounded-lg pl-10 pr-16 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-cyan-400/60 focus:shadow-[0_0_0_1px_rgba(62,224,240,0.4),0_0_20px_-6px_rgba(62,224,240,0.5)] transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPwd(!showPwd)}
                className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] tracking-widest uppercase text-slate-500 hover:text-cyan-300 transition-colors"
              >
                {showPwd ? 'Ocultar' : 'Ver'}
              </button>
            </div>

            {error && (
              <p className="text-red-300 text-sm text-center bg-red-500/10 border border-red-400/25 rounded-lg py-2 px-3">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full relative bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 disabled:from-blue-900 disabled:to-blue-800 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-all flex items-center justify-center gap-2 text-sm shadow-[0_0_24px_-8px_rgba(62,224,240,0.7)] hover:shadow-[0_0_32px_-6px_rgba(62,224,240,0.9)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
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
          <div className="px-8 pb-6">
            <div className="border-t border-white/5 pt-4">
              <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-600 mb-2">
                Acceso rápido · demo
              </p>
              <div className="space-y-1">
                {CUENTAS_DEMO.map(c => (
                  <button
                    key={c.email}
                    type="button"
                    onClick={() => fillDemo(c.email, c.pass)}
                    className="w-full flex items-center justify-between gap-3 text-left px-3 py-2 rounded-lg text-xs border border-transparent text-slate-400 hover:bg-cyan-400/[0.06] hover:border-cyan-400/20 hover:text-slate-200 transition-colors"
                  >
                    <span className="font-medium text-slate-300 whitespace-nowrap">{c.label}</span>
                    <span className="font-mono text-[11px] text-slate-500 truncate">{c.email}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <p className="text-center font-mono text-[10px] tracking-[0.25em] uppercase text-slate-600 mt-6">
          Limablue Agenda © {new Date().getFullYear()} · Lima, Perú
        </p>
      </div>
    </div>
  );
}
