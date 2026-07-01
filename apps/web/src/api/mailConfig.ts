import { api } from './client';

export interface MailConfig {
  fromEmail: string;
  fromName: string;
  provider: string;
  isActive: boolean;
  connected: boolean;          // ¿hay una cuenta de Google conectada y lista?
  actualizadoEn: string | null;
}

export const mailConfigApi = {
  obtener: () => api.get<MailConfig>('/herramientas/mail-config'),

  guardar: (data: { fromEmail: string; fromName: string }) =>
    api.put<MailConfig>('/herramientas/mail-config', data),

  // Devuelve la URL de consentimiento de Google para abrir en una pestaña.
  obtenerUrlOAuth: () => api.get<{ url: string }>('/herramientas/mail-config/oauth/url'),

  enviarPrueba: (to: string) =>
    api.post<{ ok: boolean; to: string }>('/herramientas/mail-config/test', { to }),
};
