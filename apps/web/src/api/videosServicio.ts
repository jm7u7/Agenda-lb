import { api } from './client';

export type MomentoVideo = 'ANTES' | 'DESPUES';
export type UnidadOffset = 'HORAS' | 'DIAS' | 'MESES' | 'ANIOS';
export type EstadoEnvioVideo = 'PENDIENTE' | 'ENVIADO' | 'CANCELADO' | 'ERROR';

export interface ServicioVideo {
  id: string;
  servicioId: string;
  youtubeVideoId: string;
  youtubeUrl: string;
  asunto: string;
  tituloVideo: string;
  cuerpoTexto: string;
  momento: MomentoVideo;
  offsetValor: number;
  offsetUnidad: UnidadOffset;
  orden: number;
  activo: boolean;
  creadoEn: string;
  actualizadoEn: string;
}

export interface ServicioResumen {
  id: string;
  nombre: string;
  color: string;
  unidad: string | null;
  videos: number;
}

export interface HistorialEnvio {
  id: string;
  estado: EstadoEnvioVideo;
  scheduledFor: string;
  sentAt: string | null;
  error: string | null;
  motivoCancelacion: string | null;
  intentos: number;
  email: string;
  video: string | null;
  servicio: string | null;
  paciente: string | null;
  citaFecha: string | null;
  citaHora: string | null;
  sede: string | null;
}

export interface VideoInput {
  servicioId: string;
  youtubeUrl: string;
  asunto: string;
  tituloVideo: string;
  cuerpoTexto: string;
  momento: MomentoVideo;
  offsetValor: number;
  offsetUnidad: UnidadOffset;
  orden?: number;
}

export interface PreviewInput {
  asunto: string;
  tituloVideo: string;
  cuerpoTexto: string;
  youtubeUrl: string;
}

export const videosServicioApi = {
  // Selector: todos los servicios con su conteo de videos (para los badges).
  resumen: () => api.get<ServicioResumen[]>('/servicio-videos/resumen'),

  // Videos de un servicio (activos y pausados, no eliminados).
  listar: (servicioId: string) => api.get<ServicioVideo[]>('/servicio-videos', { servicioId }),

  crear: (data: VideoInput) => api.post<ServicioVideo>('/servicio-videos', data),

  editar: (id: string, data: Omit<VideoInput, 'servicioId'>) =>
    api.put<ServicioVideo>(`/servicio-videos/${id}`, data),

  toggle: (id: string) => api.patch<ServicioVideo>(`/servicio-videos/${id}/toggle`),

  eliminar: (id: string) =>
    api.delete<{ ok: boolean; enviosCancelados: number }>(`/servicio-videos/${id}`),

  testEnvio: (id: string) =>
    api.post<{ ok: boolean; to: string; id: string | null }>(`/servicio-videos/${id}/test-envio`),

  // Vista previa del correo (mismo motor que el envío real).
  preview: (data: PreviewInput) =>
    api.post<{ subject: string; html: string; videoId: string }>('/servicio-videos/preview', data),

  historial: (params: Record<string, string>) =>
    api.get<HistorialEnvio[]>('/servicio-videos/historial', params),

  // Lista de exclusión de videos educativos (no afecta los correos de confirmación).
  listarSupresiones: () => api.get<VideoSupresion[]>('/servicio-videos/supresiones'),
  agregarSupresion: (email: string, motivo?: string) =>
    api.post<VideoSupresion & { enviosCancelados: number }>('/servicio-videos/supresiones', { email, motivo }),
  quitarSupresion: (id: string) =>
    api.delete<{ ok: boolean }>(`/servicio-videos/supresiones/${id}`),
};

export interface VideoSupresion {
  id: string;
  email: string;
  motivo: string | null;
  creadoEn: string;
}

// ── Helpers de presentación compartidos ──────────────────────────────────────
/** Palabra de la unidad, con singular/plural: 1→"día", 2→"días", 1→"año", 3→"meses". */
function palabraUnidad(valor: number, unidad: UnidadOffset): string {
  switch (unidad) {
    case 'HORAS': return valor === 1 ? 'hora' : 'horas';
    case 'DIAS': return valor === 1 ? 'día' : 'días';
    case 'MESES': return valor === 1 ? 'mes' : 'meses';
    case 'ANIOS': return valor === 1 ? 'año' : 'años';
  }
}

/** Texto legible del momento de envío: "24 h antes", "2 días después", "1 año después". */
export function etiquetaMomento(momento: MomentoVideo, valor: number, unidad: UnidadOffset): string {
  const uCorta = unidad === 'HORAS' ? 'h' : palabraUnidad(valor, unidad);
  return `${valor} ${uCorta} ${momento === 'ANTES' ? 'antes' : 'después'}`;
}

/** Frase completa en vivo para el modal: "Se enviará 1 año después de la cita". */
export function fraseMomento(momento: MomentoVideo, valor: number, unidad: UnidadOffset): string {
  return `Se enviará ${valor} ${palabraUnidad(valor, unidad)} ${momento === 'ANTES' ? 'antes' : 'después'} de la cita`;
}
