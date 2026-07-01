import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { mailConfigApi } from '../../api/mailConfig';
import { useAuthStore } from '../../stores/authStore';

export function ConfirmacionMailPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isAdmin = useAuthStore(s => s.isAdmin());

  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');
  const [destinoPrueba, setDestinoPrueba] = useState('');

  const { data: config, isLoading } = useQuery({
    queryKey: ['mail-config'],
    queryFn: mailConfigApi.obtener,
    enabled: isAdmin,
  });

  // Sincronizar el formulario cuando llega la config.
  useEffect(() => {
    if (config) {
      setFromEmail(config.fromEmail ?? '');
      setFromName(config.fromName ?? '');
    }
  }, [config]);

  // Al volver del flujo OAuth (?conectado=1) o recibir el postMessage del popup,
  // refrescamos el estado de conexión.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('conectado') === '1') {
      toast.success('Cuenta de Google conectada');
      qc.invalidateQueries({ queryKey: ['mail-config'] });
      window.history.replaceState({}, '', window.location.pathname);
    }
    const onMessage = (e: MessageEvent) => {
      if (e.data?.tipo === 'limablue-oauth') {
        if (e.data.ok) toast.success('Cuenta de Google conectada');
        qc.invalidateQueries({ queryKey: ['mail-config'] });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [qc]);

  const guardarMutation = useMutation({
    mutationFn: () => mailConfigApi.guardar({ fromEmail, fromName }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mail-config'] });
      toast.success('Configuración guardada');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const conectarMutation = useMutation({
    mutationFn: mailConfigApi.obtenerUrlOAuth,
    onSuccess: ({ url }) => {
      // Abrimos el consentimiento de Google en un popup.
      window.open(url, 'limablue-oauth', 'width=520,height=660');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pruebaMutation = useMutation({
    mutationFn: () => mailConfigApi.enviarPrueba(destinoPrueba),
    onSuccess: ({ to }) => toast.success(`Correo de prueba enviado a ${to}`),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50 text-slate-400 text-sm">
        Solo los administradores pueden configurar el correo de confirmación.
      </div>
    );
  }

  const conectado = config?.connected ?? false;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button
          onClick={() => navigate('/herramientas')}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-all"
          title="Volver a Herramientas"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="w-9 h-9 rounded-xl bg-limablue-600 flex items-center justify-center shrink-0">
          <span className="text-white text-lg">✉️</span>
        </div>
        <div>
          <h1 className="text-base font-bold text-slate-900">Sistema de Confirmación por Mail</h1>
          <p className="text-xs text-slate-500">Envía confirmaciones de cita desde el correo de Limablue</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-limablue-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Aviso de portabilidad / prueba → producción */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3">
              <span className="text-lg leading-none">💡</span>
              <p className="text-xs text-blue-800 leading-relaxed">
                Puedes usar un <strong>Gmail de prueba</strong> ahora y cambiar a la cuenta{' '}
                <strong>@limablue</strong> más adelante sin perder nada: solo vuelve a conectar la
                cuenta nueva desde aquí. Toda la configuración se guarda en la base de datos.
              </p>
            </div>

            {/* Estado de conexión */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${
                    conectado ? 'bg-emerald-100' : 'bg-slate-100'
                  }`}
                >
                  {conectado ? '✅' : '🔌'}
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {conectado ? 'Cuenta de Google conectada' : 'Sin cuenta conectada'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {conectado
                      ? config?.fromEmail || 'Lista para enviar confirmaciones'
                      : 'Conecta una cuenta de Google para poder enviar correos'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => conectarMutation.mutate()}
                disabled={conectarMutation.isPending}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
                  conectado
                    ? 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                    : 'bg-limablue-600 text-white hover:bg-limablue-700'
                } disabled:opacity-50`}
              >
                {conectarMutation.isPending
                  ? 'Abriendo…'
                  : conectado
                  ? 'Reconectar / cambiar cuenta'
                  : 'Conectar cuenta de Google'}
              </button>
            </div>

            {/* Datos del remitente */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Remitente</p>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Correo remitente</label>
                <input
                  type="email"
                  value={fromEmail}
                  onChange={e => setFromEmail(e.target.value)}
                  placeholder="confirmaciones@limablue.pe"
                  className="input w-full text-sm"
                />
                <p className="mt-1 text-xxs text-slate-400">
                  Debe ser la misma cuenta de Gmail que autorizas arriba.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nombre a mostrar</label>
                <input
                  type="text"
                  value={fromName}
                  onChange={e => setFromName(e.target.value)}
                  placeholder="Limablue Podología"
                  className="input w-full text-sm"
                />
                <p className="mt-1 text-xxs text-slate-400">
                  Es el nombre que verá el paciente como remitente del correo.
                </p>
              </div>

              <button
                onClick={() => guardarMutation.mutate()}
                disabled={guardarMutation.isPending || !fromEmail || !fromName}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-limablue-600 text-white hover:bg-limablue-700 disabled:opacity-40 transition-colors"
              >
                {guardarMutation.isPending ? 'Guardando…' : 'Guardar configuración'}
              </button>
            </div>

            {/* Correo de prueba */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Probar envío</p>
              <p className="text-xs text-slate-500">
                Envía un correo de prueba para verificar que la conexión funciona.
              </p>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={destinoPrueba}
                  onChange={e => setDestinoPrueba(e.target.value)}
                  placeholder="tucorreo@ejemplo.com"
                  className="input flex-1 text-sm"
                />
                <button
                  onClick={() => pruebaMutation.mutate()}
                  disabled={pruebaMutation.isPending || !destinoPrueba || !conectado}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors whitespace-nowrap"
                  title={!conectado ? 'Primero conecta una cuenta de Google' : undefined}
                >
                  {pruebaMutation.isPending ? 'Enviando…' : 'Enviar prueba'}
                </button>
              </div>
              {!conectado && (
                <p className="text-xxs text-amber-600">
                  Conecta una cuenta de Google antes de enviar la prueba.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
