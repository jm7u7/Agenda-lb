import { api } from './client';

export interface MailConfig {
  fromEmail: string;
  fromName: string;
  provider: string;            // 'resend'
  isActive: boolean;
  connected: boolean;          // ¿hay API key de Resend en el entorno del servidor?
  actualizadoEn: string | null;
}

export type EstadoDominio = 'verified' | 'pending' | 'failed';

export interface DominioResend {
  configurado: boolean;               // ¿hay RESEND_API_KEY en el servidor?
  dominio: string;                    // 'limablue.pe'
  estado: EstadoDominio | null;       // null si no está configurado o no es consultable
  region: string | null;             // p. ej. 'sa-east-1'
  consultable?: boolean;              // ¿la key puede leer el estado del dominio?
  motivo?: string;                    // explicación si no es consultable (key de solo envío)
}

export interface ResultadoPrueba {
  ok: boolean;
  to: string;
  id: string | null;                  // id del correo en Resend
}

export const mailConfigApi = {
  obtener: () => api.get<MailConfig>('/herramientas/mail-config'),

  guardar: (data: { fromEmail: string; fromName: string }) =>
    api.put<MailConfig>('/herramientas/mail-config', data),

  // Estado del dominio de envío en Resend (verified / pending / failed) + región.
  estadoDominio: () => api.get<DominioResend>('/herramientas/mail-config/dominio'),

  enviarPrueba: (to: string) =>
    api.post<ResultadoPrueba>('/herramientas/mail-config/test', { to }),
};
