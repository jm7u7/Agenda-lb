import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { mailConfigApi, type EstadoDominio } from '../../api/mailConfig';
import { useAuthStore } from '../../stores/authStore';

const DOMINIO = 'limablue.pe';

const BADGE_DOMINIO: Record<EstadoDominio, { label: string; clase: string; icono: string }> = {
  verified: { label: 'Verificado', clase: 'bg-emerald-100 text-emerald-700 border-emerald-200', icono: '✓' },
  pending: { label: 'Pendiente', clase: 'bg-amber-100 text-amber-700 border-amber-200', icono: '⏳' },
  failed: { label: 'Con problemas', clase: 'bg-red-100 text-red-700 border-red-200', icono: '⚠' },
};

export function ConfirmacionMailPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isAdmin = useAuthStore((s) => s.isAdmin());

  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');
  const [destinoPrueba, setDestinoPrueba] = useState('');
  const [resultadoPrueba, setResultadoPrueba] = useState<{ ok: boolean; texto: string } | null>(null);

  const { data: config, isLoading } = useQuery({
    queryKey: ['mail-config'],
    queryFn: mailConfigApi.obtener,
    enabled: isAdmin,
  });

  // Estado del dominio en Resend. Query independiente: si falla, NO rompe el resto
  // de la pantalla (se muestra un estado de error propio).
  const dominioQ = useQuery({
    queryKey: ['mail-config-dominio'],
    queryFn: mailConfigApi.estadoDominio,
    enabled: isAdmin,
    retry: false,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (config) {
      setFromEmail(config.fromEmail || 'citas@limablue.pe');
      setFromName(config.fromName || 'Limablue Podología');
    }
  }, [config]);

  const guardarMutation = useMutation({
    mutationFn: () => mailConfigApi.guardar({ fromEmail: fromEmail.trim(), fromName: fromName.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mail-config'] });
      toast.success('Configuración guardada');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pruebaMutation = useMutation({
    mutationFn: () => mailConfigApi.enviarPrueba(destinoPrueba.trim()),
    onSuccess: (r) => {
      setResultadoPrueba({ ok: true, texto: `Enviado a ${r.to}${r.id ? ` · id Resend: ${r.id}` : ''}` });
      toast.success('Correo de prueba enviado');
    },
    onError: (e: Error) => {
      setResultadoPrueba({ ok: false, texto: e.message });
      toast.error('No se pudo enviar la prueba');
    },
  });

  if (!isAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50 text-slate-400 text-sm">
        Solo los administradores pueden configurar el correo de confirmación.
      </div>
    );
  }

  const emailValido = /@limablue\.pe$/i.test(fromEmail.trim());
  const apiKeyPresente = config?.connected ?? false;
  const dominioBadge = dominioQ.data?.estado ? BADGE_DOMINIO[dominioQ.data.estado] : null;

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
            {/* Proveedor: Resend + estado del dominio */}
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-10 h-10 rounded-full bg-limablue-50 flex items-center justify-center text-lg shrink-0">📮</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">Proveedor: Resend</p>
                    <p className="text-xs text-slate-500 truncate">
                      Dominio de envío: <span className="font-medium text-slate-700">{dominioQ.data?.dominio ?? DOMINIO}</span>
                      {dominioQ.data?.region ? <span> · región {dominioQ.data.region}</span> : null}
                    </p>
                  </div>
                </div>

                {/* Badge de estado del dominio (3 estados) + carga/error */}
                <div className="shrink-0">
                  {dominioQ.isLoading ? (
                    <div className="w-5 h-5 border-2 border-limablue-400 border-t-transparent rounded-full animate-spin" />
                  ) : dominioQ.isError ? (
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full border bg-slate-100 text-slate-500 border-slate-200">
                      Estado no disponible
                    </span>
                  ) : dominioQ.data && !dominioQ.data.configurado ? (
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full border bg-amber-100 text-amber-700 border-amber-200">
                      Sin API key
                    </span>
                  ) : dominioQ.data && dominioQ.data.consultable === false ? (
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full border bg-slate-100 text-slate-500 border-slate-200">
                      No consultable
                    </span>
                  ) : dominioBadge ? (
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${dominioBadge.clase}`}>
                      {dominioBadge.icono} {dominioBadge.label}
                    </span>
                  ) : null}
                </div>
              </div>

              {dominioQ.isError && (
                <p className="text-xs text-amber-600 mt-3">
                  No se pudo consultar el estado del dominio en Resend. El resto de la configuración sigue disponible.{' '}
                  <button onClick={() => dominioQ.refetch()} className="font-semibold underline hover:text-amber-700">
                    Reintentar
                  </button>
                </p>
              )}
              {dominioQ.data && !dominioQ.data.configurado && (
                <p className="text-xs text-amber-600 mt-3">
                  Falta <code>RESEND_API_KEY</code> en el entorno del servidor. Configúrala para poder enviar correos.
                </p>
              )}
              {dominioQ.data?.configurado && dominioQ.data.consultable === false && (
                <p className="text-xs text-slate-500 mt-3">
                  {dominioQ.data.motivo ?? 'El estado del dominio no es consultable con esta API key.'} El envío de correos sí funciona con normalidad.
                </p>
              )}
              {dominioQ.data?.estado === 'pending' && (
                <p className="text-xs text-amber-600 mt-3">
                  El dominio aún se está verificando en Resend. Los envíos pueden fallar hasta que quede verificado.
                </p>
              )}
              {dominioQ.data?.estado === 'failed' && (
                <p className="text-xs text-red-600 mt-3">
                  El dominio {DOMINIO} no está verificado en Resend. Revisa los registros DNS en el panel de Resend.
                </p>
              )}
            </div>

            {/* Datos del remitente */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Remitente</p>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Correo remitente</label>
                <input
                  type="email"
                  value={fromEmail}
                  onChange={(e) => setFromEmail(e.target.value)}
                  placeholder="citas@limablue.pe"
                  className="input w-full text-sm"
                />
                {fromEmail.trim() && !emailValido ? (
                  <p className="mt-1 text-xxs text-red-500">
                    El correo debe ser del dominio <strong>@{DOMINIO}</strong> (el único verificado en Resend).
                  </p>
                ) : (
                  <p className="mt-1 text-xxs text-slate-400">Debe ser una dirección del dominio @{DOMINIO}.</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nombre a mostrar</label>
                <input
                  type="text"
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  placeholder="Limablue Podología"
                  className="input w-full text-sm"
                />
                <p className="mt-1 text-xxs text-slate-400">Es el nombre que verá el paciente como remitente del correo.</p>
              </div>

              <button
                onClick={() => guardarMutation.mutate()}
                disabled={guardarMutation.isPending || !emailValido || !fromName.trim()}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-limablue-600 text-white hover:bg-limablue-700 disabled:opacity-40 transition-colors"
              >
                {guardarMutation.isPending ? 'Guardando…' : 'Guardar configuración'}
              </button>
            </div>

            {/* Correo de prueba */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Probar envío</p>
              <p className="text-xs text-slate-500">Envía un correo de prueba para verificar que el envío por Resend funciona.</p>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={destinoPrueba}
                  onChange={(e) => setDestinoPrueba(e.target.value)}
                  placeholder="tucorreo@ejemplo.com"
                  className="input flex-1 text-sm"
                />
                <button
                  onClick={() => { setResultadoPrueba(null); pruebaMutation.mutate(); }}
                  disabled={pruebaMutation.isPending || !destinoPrueba.trim() || !apiKeyPresente}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors whitespace-nowrap"
                  title={!apiKeyPresente ? 'Falta la API key de Resend en el servidor' : undefined}
                >
                  {pruebaMutation.isPending ? 'Enviando…' : 'Enviar prueba'}
                </button>
              </div>

              {!apiKeyPresente && (
                <p className="text-xxs text-amber-600">Falta la API key de Resend en el servidor; no se puede enviar la prueba.</p>
              )}

              {resultadoPrueba && (
                <div
                  className={`text-xs rounded-lg border px-3 py-2 leading-relaxed break-words ${
                    resultadoPrueba.ok
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : 'bg-red-50 border-red-200 text-red-700'
                  }`}
                >
                  {resultadoPrueba.ok ? '✅ ' : '⚠️ '}
                  {resultadoPrueba.texto}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
