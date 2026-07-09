// ═══════════════════════════════════════════════════════════════════════════════
// DEPRECADO - migrado a Resend [2026-07-07]
// Transporte Gmail/OAuth. YA NO tiene referencias activas: los envíos ahora pasan
// por `emailService.ts` (Resend). Se conserva intacto (junto con la tabla
// mail_config) para poder revertir si algo falla en producción; se eliminará en
// una limpieza posterior tras validar. NO añadir imports nuevos desde este archivo.
// ═══════════════════════════════════════════════════════════════════════════════
import { google } from 'googleapis';
import { prisma } from '../db';
import {
  esEmailEnviable,
  formatFechaLargaEs,
  capitalizar,
  urlMapaDireccion,
  construirUrlGoogleCalendarDeCita,
  construirIcsDeCita,
  renderPlantillaReserva,
  renderPlantillaRecordatorio,
  logoAdjunto,
  LOGO_CID,
} from './emailTemplates';

/**
 * Servicio de correo vía Gmail API (OAuth 2.0).
 *
 * NOTA (migración a Resend): las PLANTILLAS HTML, el generador de .ics y los
 * helpers neutrales se extrajeron a `emailTemplates.ts` para que Resend
 * (`emailService.ts`) reutilice exactamente lo mismo. Este archivo conserva SOLO
 * el transporte Gmail/OAuth. En la CAPA 3 se cortan sus referencias activas y se
 * marca `// DEPRECADO - migrado a Resend`.
 *
 * PORTABILIDAD: todas las credenciales OAuth se leen de variables de entorno.
 */

const SCOPE_GMAIL = 'https://www.googleapis.com/auth/gmail.send';

// ─── OAuth client ───────────────────────────────────────────────────────────
// Credenciales del proyecto de Google Cloud. Iguales en local y producción salvo
// GOOGLE_REDIRECT_URI, que cambia de http://localhost a https://...limablue...
export function crearOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Faltan variables OAuth de Google (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI). Revisa el .env.',
    );
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/** URL de consentimiento de Google para autorizar la cuenta remitente. */
export function generarUrlConsentimiento(): string {
  const oauth2 = crearOAuthClient();
  return oauth2.generateAuthUrl({
    access_type: 'offline',     // necesario para recibir refresh_token
    prompt: 'consent',          // fuerza refresh_token aunque ya se haya autorizado antes
    scope: [SCOPE_GMAIL],
  });
}

/**
 * Intercambia el `code` del callback de Google por tokens y devuelve el
 * refresh_token (token de larga duración que persistimos en MailConfig).
 */
export async function intercambiarCodePorTokens(code: string): Promise<{ refreshToken: string; email?: string }> {
  const oauth2 = crearOAuthClient();
  const { tokens } = await oauth2.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      'Google no devolvió un refresh_token. Revoca el acceso de la app en https://myaccount.google.com/permissions y vuelve a conectar.',
    );
  }

  // Intentamos leer el correo autorizado para mostrarlo/validarlo (best effort).
  let email: string | undefined;
  try {
    oauth2.setCredentials(tokens);
    const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2 });
    const info = await oauth2Api.userinfo.get();
    email = info.data.email ?? undefined;
  } catch {
    /* no crítico */
  }

  return { refreshToken: tokens.refresh_token, email };
}

// ─── Config activa ──────────────────────────────────────────────────────────
export async function getConfigActiva() {
  return prisma.mailConfig.findFirst({ where: { isActive: true }, orderBy: { actualizadoEn: 'desc' } });
}

// Cache de la última validación (clave = refreshToken) para no llamar a Google en cada
// poll de estado. Al reconectar cambia el token → la clave cambia → revalida de inmediato.
let _conexionCache: { token: string; ok: boolean; ts: number } | null = null;

/**
 * ¿Hay una cuenta conectada y REALMENTE lista para enviar? No basta con que exista un
 * refresh token: puede estar revocado o caducado (Google devuelve `invalid_grant` y los
 * correos fallan en silencio). Aquí intentamos obtener un access token desde el refresh
 * token; si falla, la cuenta NO está conectada. Resultado cacheado 60s por token.
 */
export async function estaConectado(): Promise<boolean> {
  const cfg = await getConfigActiva();
  const refreshToken = cfg?.refreshToken || process.env.GOOGLE_REFRESH_TOKEN;
  if (!cfg?.fromEmail || !refreshToken) return false;

  if (_conexionCache && _conexionCache.token === refreshToken && Date.now() - _conexionCache.ts < 60_000) {
    return _conexionCache.ok;
  }

  let ok = false;
  try {
    const oauth2 = crearOAuthClient();
    oauth2.setCredentials({ refresh_token: refreshToken });
    const res = await oauth2.getAccessToken(); // lanza invalid_grant si el token murió
    ok = !!res?.token;
  } catch {
    ok = false; // refresh token revocado/caducado o credenciales OAuth mal configuradas
  }
  _conexionCache = { token: refreshToken, ok, ts: Date.now() };
  return ok;
}

/** Email remitente activo (config en BD o, como respaldo, el del .env). */
export async function getFromEmail(): Promise<string | null> {
  const cfg = await getConfigActiva();
  return cfg?.fromEmail || process.env.MAIL_FROM_ADDRESS || null;
}

// ─── Envío de correo crudo (Gmail) ──────────────────────────────────────────
interface AdjuntoIcs {
  filename: string;
  /** Contenido del archivo .ics ya formateado (texto iCalendar). */
  contenido: string;
  /**
   * Método iCalendar declarado en la cabecera MIME. PUBLISH = "Agregar al
   * calendario" sin RSVP (pacientes). REQUEST/CANCEL = invitación que el
   * cliente (p. ej. Gmail) agrega/actualiza/elimina solo. Por defecto PUBLISH.
   */
  method?: 'PUBLISH' | 'REQUEST' | 'CANCEL';
}

interface EnviarCorreoArgs {
  to: string;
  subject: string;
  html: string;
  /** Adjunto de calendario opcional. Si viene, el correo se arma como multipart. */
  ics?: AdjuntoIcs;
}

/** Codifica un header con posibles tildes/ñ como =?UTF-8?B?...?= */
function codificarUtf8Header(valor: string): string {
  if (/^[\x00-\x7F]*$/.test(valor)) return valor; // ASCII puro, sin codificar
  return `=?UTF-8?B?${Buffer.from(valor, 'utf-8').toString('base64')}?=`;
}

/**
 * Envía un correo vía Gmail API. Usa el refresh token de la MailConfig activa
 * (o, como respaldo, GOOGLE_REFRESH_TOKEN del .env).
 *
 * Si se pasa un `.ics`, el mensaje se construye como `multipart/mixed`
 * (cuerpo HTML + adjunto de calendario) para que el cliente del paciente
 * ofrezca "Agregar al calendario" en cualquier proveedor.
 */
export async function enviarCorreo({ to, subject, html, ics }: EnviarCorreoArgs): Promise<string | null> {
  const cfg = await getConfigActiva();
  const fromEmail = cfg?.fromEmail || process.env.MAIL_FROM_ADDRESS;
  const fromName = cfg?.fromName || process.env.MAIL_FROM_NAME || 'Limablue Podología';
  const refreshToken = cfg?.refreshToken || process.env.GOOGLE_REFRESH_TOKEN;

  if (!fromEmail) throw new Error('No hay correo remitente configurado.');
  if (!refreshToken) throw new Error('La cuenta de Google no está conectada (sin refresh token).');

  const oauth2 = crearOAuthClient();
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  // Construcción del mensaje RFC 822. Asunto y From en UTF-8.
  const fromHeader = `${codificarUtf8Header(fromName)} <${fromEmail}>`;
  const cabeceras = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${codificarUtf8Header(subject)}`,
    'MIME-Version: 1.0',
  ];

  // Partes del mensaje. El logo (si hay archivo) se incrusta como imagen INLINE con
  // Content-ID para que el HTML lo muestre vía `cid:logo-limablue`.
  const b64linea = (s: string) => s.replace(/.{76}/g, '$&\r\n'); // base64 a 76 cols (RFC 2045)
  const logo = logoAdjunto();
  const nb = () => `lb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

  const bloqueHtml = [
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html, 'utf-8').toString('base64'),
  ];
  const bloqueLogo = logo ? [
    `Content-Type: ${logo.mime}; name="logo-limablue"`,
    'Content-Transfer-Encoding: base64',
    `Content-ID: <${LOGO_CID}>`,
    'Content-Disposition: inline; filename="logo-limablue"',
    '',
    b64linea(logo.base64),
  ] : null;
  const bloqueIcs = ics ? [
    // PUBLISH → "Agregar al calendario" sin RSVP (pacientes); REQUEST/CANCEL →
    // invitación que el calendario del invitado agrega/actualiza/elimina solo.
    `Content-Type: text/calendar; charset=UTF-8; method=${ics.method ?? 'PUBLISH'}; name="${ics.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${ics.filename}"`,
    '',
    Buffer.from(ics.contenido, 'utf-8').toString('base64'),
  ] : null;

  // HTML + logo van juntos en multipart/related (para que el cid: resuelva).
  let cuerpo: string[];
  let cuerpoCT: string;
  if (bloqueLogo) {
    const rel = nb();
    cuerpoCT = `multipart/related; boundary="${rel}"`;
    // El '' inicial es el SALTO DE LÍNEA obligatorio entre la cabecera Content-Type
    // de la parte y el primer límite --rel (sin él, los parsers estrictos como Outlook
    // no resuelven el cid: y el logo sale roto).
    cuerpo = ['', `--${rel}`, ...bloqueHtml, `--${rel}`, ...bloqueLogo, `--${rel}--`];
  } else {
    cuerpoCT = 'text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64';
    cuerpo = ['', Buffer.from(html, 'utf-8').toString('base64')];
  }

  let mensaje: string;
  if (bloqueIcs) {
    // multipart/mixed { cuerpo(html+logo) ; ics }
    const mix = nb();
    mensaje = [
      ...cabeceras,
      `Content-Type: multipart/mixed; boundary="${mix}"`,
      '',
      `--${mix}`,
      `Content-Type: ${cuerpoCT}`,
      ...cuerpo,
      `--${mix}`,
      ...bloqueIcs,
      `--${mix}--`,
    ].join('\r\n');
  } else {
    mensaje = [...cabeceras, `Content-Type: ${cuerpoCT}`, ...cuerpo].join('\r\n');
  }

  const raw = Buffer.from(mensaje, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const enviado = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  return enviado.data.id ?? null;
}

// ─── Correo 1: confirmación de reserva (inmediato, simple) ───────────────────
async function cargarCitaCorreo(citaId: string) {
  const cita = await prisma.cita.findUnique({
    where: { id: citaId },
    include: { paciente: true, profesional: true, sede: true, servicio: true },
  });
  if (!cita) throw new Error('Cita no encontrada');
  if (!cita.paciente.email) throw new Error('El paciente no tiene correo registrado.');
  if (!esEmailEnviable(cita.paciente.email)) {
    throw new Error(`Correo no enviable: ${cita.paciente.email}`);
  }
  return cita;
}

/** Correo 1 — "Tu cita quedó registrada". Simple, sin botones ni adjunto. */
export async function enviarCorreoReserva(citaId: string): Promise<{ to: string; gmailMessageId: string | null }> {
  const cita = await cargarCitaCorreo(citaId);
  const fechaLarga = capitalizar(formatFechaLargaEs(cita.fecha));
  const profesional = cita.profesional ? `${cita.profesional.nombres} ${cita.profesional.apellidos}` : null;

  const citaIcs = {
    id: cita.id, fecha: cita.fecha, horaInicio: cita.horaInicio,
    servicio: { nombre: cita.servicio.nombre, duracionMinutos: cita.servicio.duracionMinutos },
    profesional: cita.profesional ? { nombres: cita.profesional.nombres, apellidos: cita.profesional.apellidos } : null,
    sede: { nombre: cita.sede.nombre, direccion: cita.sede.direccion },
  };

  const html = renderPlantillaReserva({
    nombrePaciente: `${cita.paciente.nombres} ${cita.paciente.apellidoPaterno}`,
    servicio: cita.servicio.nombre,
    fechaDate: cita.fecha,
    hora: cita.horaInicio,
    sede: cita.sede.nombre,
    direccion: cita.sede.direccion,
    profesional,
    urlCalendario: construirUrlGoogleCalendarDeCita(citaIcs),
    urlMapa: urlMapaDireccion(cita.sede.direccion),
  });

  const gmailMessageId = await enviarCorreo({
    to: cita.paciente.email!,
    subject: `Tu cita en Limablue quedó registrada · ${fechaLarga}`,
    html,
  });
  return { to: cita.paciente.email!, gmailMessageId };
}

// ─── Correo 2: recordatorio con acciones (confirmar / reprogramar) ───────────
/** Correo 2 — recordatorio con .ics, botón de calendario y los 2 botones de acción. */
export async function enviarCorreoRecordatorio(args: {
  citaId: string;
  urlConfirmar: string;
  urlReprogramar: string;
}): Promise<{ to: string; gmailMessageId: string | null }> {
  const cita = await cargarCitaCorreo(args.citaId);
  const fechaLarga = capitalizar(formatFechaLargaEs(cita.fecha));
  const profesional = cita.profesional ? `${cita.profesional.nombres} ${cita.profesional.apellidos}` : null;

  const citaIcs = {
    id: cita.id,
    fecha: cita.fecha,
    horaInicio: cita.horaInicio,
    servicio: { nombre: cita.servicio.nombre, duracionMinutos: cita.servicio.duracionMinutos },
    profesional: cita.profesional ? { nombres: cita.profesional.nombres, apellidos: cita.profesional.apellidos } : null,
    sede: { nombre: cita.sede.nombre, direccion: cita.sede.direccion },
  };

  const html = renderPlantillaRecordatorio({
    nombrePaciente: `${cita.paciente.nombres} ${cita.paciente.apellidoPaterno}`,
    servicio: cita.servicio.nombre,
    fechaDate: cita.fecha,
    hora: cita.horaInicio,
    sede: cita.sede.nombre,
    direccion: cita.sede.direccion,
    profesional,
    urlConfirmar: args.urlConfirmar,
    urlReprogramar: args.urlReprogramar,
    urlCalendario: construirUrlGoogleCalendarDeCita(citaIcs),
    urlMapa: urlMapaDireccion(cita.sede.direccion),
  });

  const gmailMessageId = await enviarCorreo({
    to: cita.paciente.email!,
    subject: `Recordatorio de tu cita en Limablue · ${fechaLarga} ${cita.horaInicio}`,
    html,
    ics: { filename: 'cita-limablue.ics', contenido: construirIcsDeCita(citaIcs) },
  });
  return { to: cita.paciente.email!, gmailMessageId };
}
