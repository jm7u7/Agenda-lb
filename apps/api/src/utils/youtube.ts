/**
 * Helpers de YouTube para el módulo de Videos por Servicio.
 *
 * El admin pega la URL de un video "No listado" (unlisted). De ahí extraemos y
 * validamos el `videoId` (11 chars). Soportamos los 3 formatos del prompt:
 *   - https://www.youtube.com/watch?v=VIDEOID
 *   - https://youtu.be/VIDEOID
 *   - https://www.youtube.com/shorts/VIDEOID
 * (también youtube-nocookie.com, m.youtube.com, con o sin parámetros extra).
 *
 * En el CORREO no se puede embeber un iframe (Gmail/Outlook bloquean iframes/JS):
 * se muestra un thumbnail vertical clicable que abre YouTube (en móvil, pantalla
 * completa automática). En el MÓDULO admin sí se embebe con iframe para previsualizar.
 */

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extrae el videoId de una URL de YouTube en cualquiera de los formatos soportados,
 * o `null` si la URL no es válida. Acepta también un videoId "pelado" (11 chars).
 */
export function extraerYoutubeVideoId(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  if (!s) return null;

  // Ya es un videoId pelado.
  if (VIDEO_ID_RE.test(s)) return s;

  let url: URL;
  try {
    url = new URL(s.includes('://') ? s : `https://${s}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '').toLowerCase();
  const esYoutube =
    host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'youtu.be';
  if (!esYoutube) return null;

  // youtu.be/VIDEOID
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return id && VIDEO_ID_RE.test(id) ? id : null;
  }

  // youtube.com/watch?v=VIDEOID
  const v = url.searchParams.get('v');
  if (v && VIDEO_ID_RE.test(v)) return v;

  // youtube.com/shorts/VIDEOID  |  /embed/VIDEOID  |  /v/VIDEOID  |  /live/VIDEOID
  const partes = url.pathname.split('/').filter(Boolean);
  const idx = partes.findIndex((p) => ['shorts', 'embed', 'v', 'live'].includes(p));
  if (idx !== -1 && partes[idx + 1] && VIDEO_ID_RE.test(partes[idx + 1])) {
    return partes[idx + 1];
  }

  return null;
}

/** ¿La URL original era un Short? (cambia el enlace del correo a /shorts/). */
export function esShort(url: string | null | undefined): boolean {
  return !!url && /\/shorts\//i.test(url);
}

/**
 * Enlace público al que abre el thumbnail del correo. Si el original era un Short,
 * usa /shorts/{id} (abre el reproductor vertical a pantalla completa en móvil); si no,
 * watch?v={id}.
 */
export function urlPublicaYoutube(videoId: string, short: boolean): string {
  return short
    ? `https://youtube.com/shorts/${videoId}`
    : `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * URL del thumbnail VERTICAL (9:16) de un Short: `oardefault.jpg`. Es el formato que
 * pide el diseño para el correo. Para videos que no son Shorts YouTube puede no tener
 * `oardefault`; en el correo el botón "▶ Ver video" cubre el caso de imagen rota, y en
 * el módulo admin la miniatura cae a `hqdefault` vía onerror (el navegador sí lo soporta).
 */
export function thumbnailVertical(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/oardefault.jpg`;
}

/** URL del thumbnail 16:9 estándar (`hqdefault.jpg`) — fallback siempre disponible. */
export function thumbnailFallback(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/** URL de embed para el iframe de PREVISUALIZACIÓN en el módulo admin (no en el correo). */
export function urlEmbedNocookie(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}?fs=1`;
}
