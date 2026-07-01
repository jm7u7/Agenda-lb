import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { prisma } from '../db';
import { citaInicioUtc } from '../utils/fechaLima';

// ─── Logo de la cabecera de los correos ───────────────────────────────────────
// Los clientes de correo NO renderizan SVG ni rutas locales con fiabilidad, así que
// el logo se INCRUSTA por CID (Content-ID): se adjunta el PNG/JPG y el HTML lo
// referencia con `cid:logo-limablue`. Coloca tu logo en:
//   apps/api/assets/correo/logo-correo.png   (o .jpg / .jpeg)
// Si no hay archivo, cae a MAIL_LOGO_URL (URL pública) y, si tampoco, al wordmark.
const LOGO_CID = 'logo-limablue';

function rutaLogoCorreo(): string | null {
  const dir = path.join(__dirname, '../../assets/correo');
  for (const f of ['logo-correo.png', 'logo-correo.jpg', 'logo-correo.jpeg']) {
    const p = path.join(dir, f);
    try { if (fs.existsSync(p)) return p; } catch { /* noop */ }
  }
  return null;
}

/** Devuelve el archivo del logo listo para adjuntar (base64 + mime), o null. */
function logoAdjunto(): { mime: string; base64: string } | null {
  const p = rutaLogoCorreo();
  if (!p) return null;
  try {
    const mime = p.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return { mime, base64: fs.readFileSync(p).toString('base64') };
  } catch { return null; }
}

/** Etiqueta <img> del logo para la cabecera (centrado sobre el azul): CID si hay archivo,
 * si no MAIL_LOGO_URL, si no el wordmark de texto. El logo se usa en versión BLANCA, así
 * que va directo sobre la cabecera azul (#1e3a8a) sin recuadro. */
function logoMarcaHtml(widthPx: number): string {
  const estilo = `display:block;width:${widthPx}px;max-width:72%;height:auto;margin:0 auto;border:0;`;
  if (rutaLogoCorreo()) return `<img src="cid:${LOGO_CID}" alt="limablue Agenda" width="${widthPx}" style="${estilo}">`;
  const url = process.env.MAIL_LOGO_URL?.trim();
  if (url) return `<img src="${url}" alt="limablue Agenda" width="${widthPx}" style="${estilo}">`;
  return `<span style="color:#ffffff;font-size:28px;font-weight:800;font-style:italic;letter-spacing:-.02em;">limablue</span>`;
}

/**
 * Servicio de correo — envía confirmaciones de cita vía Gmail API (OAuth 2.0).
 *
 * PORTABILIDAD: todas las credenciales OAuth se leen de variables de entorno y los
 * enlaces se construyen con API_BASE_URL. Mover el proyecto a producción solo
 * requiere ajustar el .env (ver README). Nada está hardcodeado.
 */

const SCOPE_GMAIL = 'https://www.googleapis.com/auth/gmail.send';

// Dominios de relleno/demo a los que NUNCA se envía (evita rebotes de datos de prueba).
const DOMINIOS_NO_ENVIABLES = new Set([
  'email.com', 'example.com', 'example.org', 'test.com', 'ejemplo.com', 'correo.com',
  'mail.test', 'limablue-test.pe',
]);

/**
 * ¿Se le puede enviar correo a esta dirección sin que rebote?
 * - Debe ser ASCII (sin acentos/ñ/mojibake en la dirección: muchos servidores no soportan SMTPUTF8).
 * - Formato de email válido.
 * - No ser un dominio de relleno/demo (lista explícita o cualquier dominio que contenga "test").
 * Los pacientes demo tienen correos como "maría.garcía0@email.com" o "...@limablue-test.pe" → se omiten.
 */
export function esEmailEnviable(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim();
  if (!/^[\x00-\x7F]+$/.test(e)) return false;                 // solo ASCII
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return false;  // formato básico
  const dominio = e.split('@')[1]?.toLowerCase() ?? '';
  if (DOMINIOS_NO_ENVIABLES.has(dominio)) return false;
  if (/(^|\.)test\b|-test\.|\btest-/.test(dominio)) return false; // cualquier dominio de prueba
  return true;
}

// Nombres en español para formatear fechas sin depender de date-fns-tz (que tiene
// una incompatibilidad de versión en este monorepo). La fecha de la cita es @db.Date
// (medianoche UTC), así que usamos getters UTC para no desfasar el día.
const DIAS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Devuelve, p.ej., "lunes 16 de junio 2026". */
function formatFechaLargaEs(fecha: Date): string {
  return `${DIAS_ES[fecha.getUTCDay()]} ${fecha.getUTCDate()} de ${MESES_ES[fecha.getUTCMonth()]} ${fecha.getUTCFullYear()}`;
}

const MESES_ABREV_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
/** Partes del bloque "hero" de fecha: { mes:'Jun', dia:'22', diaSemana:'Lunes' } (hora Lima). */
function partesFechaHero(fecha: Date) {
  const ds = DIAS_ES[fecha.getUTCDay()]!;
  return { mes: MESES_ABREV_ES[fecha.getUTCMonth()]!, dia: String(fecha.getUTCDate()), diaSemana: ds.charAt(0).toUpperCase() + ds.slice(1) };
}
/** "08:00" → { hora:'08:00', suf:'a. m.' }; "14:30" → { hora:'02:30', suf:'p. m.' }. */
function horaAmPm(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  const suf = (h ?? 0) < 12 ? 'a. m.' : 'p. m.';
  const h12 = (((h ?? 0) + 11) % 12) + 1;
  return { hora: `${String(h12).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`, suf };
}
/** Enlace a Google Maps para mostrar la ubicación de la sede. */
function urlMapaDireccion(direccion: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}`;
}

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

// ─── Envío de correo crudo ──────────────────────────────────────────────────
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

// ─── Generación del .ics (iCalendar) ─────────────────────────────────────────
/** Escapa texto para un valor iCalendar (RFC 5545). */
function escaparIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Formatea una fecha a UTC `YYYYMMDDTHHMMSSZ`. */
function fechaUtcIcs(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Plega líneas a ≤75 octetos según RFC 5545 (continuación con un espacio).
 * Trabaja sobre los bytes UTF-8 y nunca parte un carácter multibyte (tildes,
 * ñ, em-dash…), evitando que se corrompa el texto en el calendario.
 */
function plegarLinea(linea: string): string {
  const bytes = Buffer.from(linea, 'utf-8');
  if (bytes.length <= 75) return linea;

  const segmentos: Buffer[] = [];
  let i = 0;
  let primero = true;
  while (i < bytes.length) {
    const max = primero ? 75 : 74; // las continuaciones gastan 1 byte en el espacio
    let fin = Math.min(i + max, bytes.length);
    // No cortar a mitad de un carácter UTF-8 (bytes de continuación: 0x80–0xBF).
    while (fin > i && fin < bytes.length && (bytes[fin]! & 0xc0) === 0x80) fin--;
    segmentos.push(bytes.subarray(i, fin));
    i = fin;
    primero = false;
  }
  return segmentos.map((b, idx) => (idx === 0 ? '' : ' ') + b.toString('utf-8')).join('\r\n');
}

interface DatosIcs {
  uid: string;
  inicioUtc: Date;
  finUtc: Date;
  titulo: string;
  descripcion: string;
  ubicacion: string;
}

/** Opciones del .ics. Por defecto reproduce el comportamiento para pacientes. */
export interface OpcionesIcs {
  /** PUBLISH (pacientes) | REQUEST (invitación) | CANCEL (cancelación). */
  metodo?: 'PUBLISH' | 'REQUEST' | 'CANCEL';
  /** Número de versión del evento; debe crecer en cada actualización (RFC 5545). */
  sequence?: number;
  /** Email organizador (necesario para REQUEST/CANCEL). */
  organizer?: string;
  /** Invitado al que se le agrega/actualiza el evento en su calendario. */
  attendee?: { email: string; nombre?: string };
  /** CONFIRMED (default) | CANCELLED. */
  status?: 'CONFIRMED' | 'CANCELLED';
  /** Incluir alarma -2h (recordatorio del paciente). */
  alarma?: boolean;
}

/**
 * Construye un archivo iCalendar (.ics) configurable.
 *  - PUBLISH (default, pacientes): permite "Agregar al calendario" sin RSVP.
 *  - REQUEST/CANCEL (invitaciones): con ORGANIZER + ATTENDEE para que el
 *    calendario del invitado lo agregue, actualice o elimine automáticamente.
 */
export function construirIcsAvanzado(d: DatosIcs, op: OpcionesIcs = {}): string {
  const metodo = op.metodo ?? 'PUBLISH';
  const status = op.status ?? 'CONFIRMED';
  const lineas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Limablue//Agenda//ES',
    'CALSCALE:GREGORIAN',
    `METHOD:${metodo}`,
    'BEGIN:VEVENT',
    `UID:${d.uid}`,
    `SEQUENCE:${op.sequence ?? 0}`,
    `DTSTAMP:${fechaUtcIcs(new Date())}`,
    `DTSTART:${fechaUtcIcs(d.inicioUtc)}`,
    `DTEND:${fechaUtcIcs(d.finUtc)}`,
    `SUMMARY:${escaparIcs(d.titulo)}`,
    `DESCRIPTION:${escaparIcs(d.descripcion)}`,
    `LOCATION:${escaparIcs(d.ubicacion)}`,
    `STATUS:${status}`,
    ...(op.organizer ? [`ORGANIZER:mailto:${op.organizer}`] : []),
    ...(op.attendee
      ? [`ATTENDEE;CN=${escaparIcs(op.attendee.nombre ?? op.attendee.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${op.attendee.email}`]
      : []),
    ...(op.alarma
      ? ['BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Recordatorio de tu cita en Limablue', 'END:VALARM']
      : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lineas.map(plegarLinea).join('\r\n');
}

/**
 * .ics METHOD:PUBLISH para el paciente (agregar al calendario en cualquier
 * proveedor). Sin ATTENDEE para no disparar RSVP.
 */
export function construirIcs(d: DatosIcs): string {
  return construirIcsAvanzado(d, { metodo: 'PUBLISH', status: 'CONFIRMED', alarma: true });
}

/** Cita con las relaciones mínimas para construir su .ics. */
export interface CitaParaIcs {
  id: string;
  fecha: Date;
  horaInicio: string;
  servicio: { nombre: string; duracionMinutos: number };
  profesional: { nombres: string; apellidos: string } | null;
  sede: { nombre: string; direccion: string };
}

/**
 * Datos normalizados del evento de una cita. Centraliza la conversión de hora
 * local de Lima (UTC-5, sin horario de verano) a UTC y el armado de los textos,
 * para que el .ics, el endpoint y el enlace de Google entreguen lo mismo.
 */
function datosEventoCita(cita: CitaParaIcs): DatosIcs {
  const profesionalNombre = cita.profesional
    ? `${cita.profesional.nombres} ${cita.profesional.apellidos}`
    : null;

  const inicioUtc = citaInicioUtc(cita.fecha, cita.horaInicio);
  const finUtc = new Date(inicioUtc.getTime() + (cita.servicio.duracionMinutos || 30) * 60000);

  const descripcion = [
    `Servicio: ${cita.servicio.nombre}`,
    profesionalNombre ? `Profesional: ${profesionalNombre}` : null,
    `Sede: ${cita.sede.nombre}`,
    'Limablue · Salud del pie',
  ].filter(Boolean).join('\n');

  return {
    uid: `cita-${cita.id}@limablue.pe`,
    inicioUtc,
    finUtc,
    titulo: `Cita Limablue · ${cita.servicio.nombre}`,
    descripcion,
    ubicacion: `${cita.sede.nombre} — ${cita.sede.direccion}`,
  };
}

/** Construye el .ics de una cita concreta (para adjunto y endpoint público). */
export function construirIcsDeCita(cita: CitaParaIcs): string {
  return construirIcs(datosEventoCita(cita));
}

/**
 * Enlace a Google Calendar que abre el evento ya cargado (un toque para
 * guardar). Funciona sin servidor propio; ideal para el botón del correo.
 * Las fechas van en UTC básico YYYYMMDDTHHMMSSZ.
 */
export function construirUrlGoogleCalendarDeCita(cita: CitaParaIcs): string {
  const ev = datosEventoCita(cita);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.titulo,
    dates: `${fechaUtcIcs(ev.inicioUtc)}/${fechaUtcIcs(ev.finUtc)}`,
    details: ev.descripcion,
    location: ev.ubicacion,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Codifica un header con posibles tildes/ñ como =?UTF-8?B?...?= */
function codificarUtf8Header(valor: string): string {
  if (/^[\x00-\x7F]*$/.test(valor)) return valor; // ASCII puro, sin codificar
  return `=?UTF-8?B?${Buffer.from(valor, 'utf-8').toString('base64')}?=`;
}

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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

// ── Plantilla Correo 1 (reserva registrada) — diseño de tarjeta (tablas, email-safe) ──
export function renderPlantillaReserva(d: DatosPlantilla): string {
  const { mes, dia, diaSemana } = partesFechaHero(d.fechaDate);
  const t = horaAmPm(d.hora);
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#e7e5df;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e7e5df;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(16,40,79,.12),0 14px 50px rgba(16,40,79,.12);">
        ${headerNuevo()}
        <!-- body -->
        <tr><td style="padding:34px 32px 30px;font-family:'Manrope',Arial,Helvetica,sans-serif;">
          <!-- badge -->
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:20px;"><tr>
            <td style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:999px;padding:6px 13px;">
              <span style="color:#047857;font-size:12px;font-weight:700;letter-spacing:.02em;">✓&nbsp; Cita registrada</span>
            </td>
          </tr></table>
          <h1 style="margin:0 0 10px;font-size:24px;font-weight:800;color:#0f1f3d;letter-spacing:-.02em;line-height:1.2;">Hola ${d.nombrePaciente} 👋</h1>
          <p style="margin:0;font-size:15px;line-height:1.6;color:#4b5563;">Tu cita en <strong style="color:#1e3a8a;">Limablue</strong> quedó registrada. Estos son los detalles:</p>

          <!-- date hero -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 6px;background:#f6f8fc;border:1px solid #e6ecf6;border-radius:12px;">
            <tr>
              <td width="78" align="center" valign="middle" style="padding:20px 0 20px 10px;">
                <div style="font-size:11px;font-weight:700;letter-spacing:.14em;color:#1e3a8a;text-transform:uppercase;">${mes}</div>
                <div style="font-size:34px;font-weight:800;color:#0f1f3d;line-height:1;letter-spacing:-.03em;">${dia}</div>
                <div style="font-size:11px;font-weight:600;color:#8a93a6;">${diaSemana}</div>
              </td>
              <td width="1" style="background:#e0e7f2;">&nbsp;</td>
              <td valign="middle" style="padding:20px 22px;">
                <div style="font-size:13px;color:#8a93a6;font-weight:600;">Hora de tu cita</div>
                <div style="font-size:26px;font-weight:800;color:#1e3a8a;letter-spacing:-.02em;">${t.hora.split('').join('&#8203;')} <span style="font-size:14px;color:#8a93a6;font-weight:600;">${t.suf}</span></div>
              </td>
            </tr>
          </table>

          <!-- detail rows -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;">
            <tr><td style="padding:14px 0;border-top:1px solid #eef1f6;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="font-size:13px;font-weight:600;color:#8a93a6;">Servicio</td>
              <td align="right" style="font-size:14px;font-weight:700;color:#0f1f3d;">${d.servicio}</td>
            </tr></table></td></tr>
            <tr><td style="padding:14px 0;border-top:1px solid #eef1f6;border-bottom:1px solid #eef1f6;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td valign="top" style="font-size:13px;font-weight:600;color:#8a93a6;">Sede</td>
              <td align="right" style="font-size:14px;font-weight:700;color:#0f1f3d;line-height:1.5;">${d.sede}<br/><span style="font-weight:500;color:#6b7280;">${d.direccion}</span></td>
            </tr></table></td></tr>
          </table>

          <!-- CTA -->
          <a href="${d.urlCalendario}" style="display:block;margin-top:24px;background:#1e3a8a;color:#ffffff;text-decoration:none;text-align:center;font-size:15px;font-weight:700;letter-spacing:.01em;padding:15px;border-radius:10px;">Agregar al calendario</a>
          <a href="${d.urlMapa}" style="display:block;margin-top:10px;color:#1e3a8a;text-decoration:none;text-align:center;font-size:13px;font-weight:700;">Ver ubicación en el mapa</a>

          <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#9aa3b2;text-align:center;">Más cerca de la fecha te enviaremos un recordatorio para confirmar tu asistencia.</p>
        </td></tr>
        ${pieNuevo()}
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// ── Plantilla Correo 2 (recordatorio/confirmación) — diseño DISTINTO (acento ámbar,
//    centrado en la acción de confirmar). Mantiene los botones confirmar/reprogramar. ──
export function renderPlantillaRecordatorio(d: DatosPlantilla & { urlConfirmar: string; urlReprogramar: string }): string {
  const { mes, dia, diaSemana } = partesFechaHero(d.fechaDate);
  const t = horaAmPm(d.hora);
  const filaProf = d.profesional ? ` · ${d.profesional}` : '';
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no"/>
<style>
  /* Evita que Apple Mail/iOS pinten la hora "08:00" como enlace azul subrayado. */
  a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;font-weight:inherit!important;font-size:inherit!important;}
</style></head>
<body style="margin:0;padding:0;background:#0f1f3d;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1f3d;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 14px 50px rgba(0,0,0,.35);">
        <!-- barra de acento ámbar (diferencia visual vs. Correo 1) -->
        <tr><td style="height:5px;background:#f59e0b;font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- hero oscuro con la fecha/hora protagonista -->
        <tr><td style="background:#1e3a8a;padding:18px 32px 24px;text-align:center;font-family:'Manrope',Arial,Helvetica,sans-serif;">
          <div style="margin-bottom:8px;">${logoMarcaHtml(140)}</div>
          <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin-bottom:16px;"><tr>
            <td style="background:rgba(245,158,11,.18);border:1px solid rgba(245,158,11,.5);border-radius:999px;padding:6px 13px;">
              <span style="color:#fde68a;font-size:12px;font-weight:700;letter-spacing:.03em;">⏰&nbsp; Recordatorio · confirma tu asistencia</span>
            </td>
          </tr></table>
          <div style="color:#ffffff;font-size:14px;font-weight:600;">${diaSemana}, ${dia} de ${MESES_ES[d.fechaDate.getUTCMonth()]}</div>
          <div style="color:#ffffff;font-size:42px;font-weight:800;letter-spacing:-.03em;line-height:1.1;margin-top:2px;"><span style="color:#ffffff;">${t.hora.split('').join('&#8203;')}</span> <span style="font-size:18px;color:#ffffff;font-weight:600;">${t.suf}</span></div>
          <div style="color:#ffffff;font-size:13px;margin-top:6px;">${d.servicio} · ${d.sede}${filaProf}</div>
        </td></tr>

        <!-- cuerpo: la pregunta + acciones -->
        <tr><td style="padding:30px 32px 26px;font-family:'Manrope',Arial,Helvetica,sans-serif;text-align:center;">
          <h1 style="margin:0 0 6px;font-size:22px;font-weight:800;color:#0f1f3d;letter-spacing:-.02em;">Hola ${d.nombrePaciente}, ¿nos vemos?</h1>
          <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#4b5563;">Confirma tu asistencia para asegurar tu cita. Si no puedes, reprográmala con un toque.</p>

          <a href="${d.urlConfirmar}" style="display:block;background:#16a34a;color:#ffffff;text-decoration:none;text-align:center;font-size:16px;font-weight:800;padding:16px;border-radius:10px;box-shadow:0 6px 18px rgba(22,163,74,.28);">✓ Sí, confirmo mi asistencia</a>
          <a href="${d.urlReprogramar}" style="display:block;margin-top:11px;background:#ffffff;color:#b45309;border:1.5px solid #fcd34d;text-decoration:none;text-align:center;font-size:15px;font-weight:700;padding:14px;border-radius:10px;">↻ Necesito reprogramar</a>

          <!-- dirección + calendario -->
          <div style="margin-top:20px;padding-top:18px;border-top:1px solid #eef1f6;">
            <div style="font-size:13px;color:#6b7280;line-height:1.5;">${d.sede} — <span style="color:#9aa3b2;">${d.direccion}</span></div>
            <a href="${d.urlCalendario}" style="display:inline-block;margin-top:12px;color:#1e3a8a;text-decoration:none;font-size:13px;font-weight:700;">📅 Agregar al calendario</a>
            <span style="color:#cbd5e1;">&nbsp;·&nbsp;</span>
            <a href="${d.urlMapa}" style="display:inline-block;margin-top:12px;color:#1e3a8a;text-decoration:none;font-size:13px;font-weight:700;">📍 Ver en el mapa</a>
          </div>

          <p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#9aa3b2;">El botón “Reprogramar” abre WhatsApp con Limablue. También adjuntamos la cita (.ics) para tu calendario.</p>
        </td></tr>
        ${pieNuevo()}
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// ─── Plantillas HTML ────────────────────────────────────────────────────────
interface DatosPlantilla {
  nombrePaciente: string;
  servicio: string;
  fechaDate: Date;   // @db.Date (mediodía UTC) — el template arma el bloque "hero" en hora Lima
  hora: string;      // "HH:mm"
  sede: string;
  direccion: string;
  profesional: string | null;
  /** Enlace de Google Calendar (botón "Agregar al calendario"). */
  urlCalendario: string;
  /** Enlace de Google Maps a la dirección de la sede. */
  urlMapa: string;
}

// Header del nuevo diseño: el LOGO de Limablue centrado sobre azul. Usa la imagen
// hospedada en MAIL_LOGO_URL (los correos no renderizan SVG: debe ser PNG/JPG en una
// URL pública). Si no está configurada, cae a un wordmark "limablue" en texto blanco.
function headerNuevo(): string {
  return `
    <tr><td style="background:#1e3a8a;padding:20px 32px;text-align:center;font-family:'Manrope',Arial,Helvetica,sans-serif;">
      ${logoMarcaHtml(160)}
    </td></tr>`;
}

function pieNuevo(): string {
  return `
    <tr><td style="padding:20px 32px 26px;border-top:1px solid #eef1f6;text-align:center;font-family:'Manrope',Arial,Helvetica,sans-serif;">
      <div style="font-size:12px;line-height:1.6;color:#aab2c0;">Este correo fue enviado por <strong style="color:#8a93a6;">Limablue Podología</strong>. Si no reconoces esta cita, ignora este mensaje.</div>
    </td></tr>`;
}

// Encabezado con branding Limablue reutilizable (logo "LB" + nombre).
function encabezadoLimablue(): string {
  return `
    <tr>
      <td style="background:#1e3a8a;padding:28px 32px;text-align:center;">
        <table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr>
          <td style="background:#ffffff;width:44px;height:44px;border-radius:12px;text-align:center;vertical-align:middle;">
            <span style="color:#1e40af;font-weight:800;font-size:18px;font-family:Arial,Helvetica,sans-serif;">LB</span>
          </td>
          <td style="padding-left:12px;text-align:left;">
            <span style="color:#ffffff;font-weight:700;font-size:20px;font-family:Arial,Helvetica,sans-serif;letter-spacing:.3px;">Limablue</span><br/>
            <span style="color:#bfdbfe;font-size:12px;font-family:Arial,Helvetica,sans-serif;">Salud del pie</span>
          </td>
        </tr></table>
      </td>
    </tr>`;
}

function pieLimablue(): string {
  return `
    <tr>
      <td style="padding:24px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
        <p style="margin:0;color:#94a3b8;font-size:12px;font-family:Arial,Helvetica,sans-serif;line-height:1.6;">
          Este correo fue enviado por Limablue · Salud del pie.<br/>
          Si no reconoces esta cita, ignora este mensaje.
        </p>
      </td>
    </tr>`;
}

/** Correo de cita con el adjunto .ics para agregar al calendario del móvil. */
/** Correo de prueba simple para validar la conexión. */
export function renderPlantillaPrueba(): string {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#eef2f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;">
        ${encabezadoLimablue()}
        <tr><td style="padding:32px;font-family:Arial,Helvetica,sans-serif;text-align:center;">
          <div style="font-size:42px;margin-bottom:8px;">✅</div>
          <h1 style="margin:0 0 8px 0;color:#0f172a;font-size:20px;">¡La conexión funciona!</h1>
          <p style="margin:0;color:#475569;font-size:15px;line-height:1.6;">
            Este es un correo de prueba del Sistema de Confirmación de Limablue Agenda.
            La cuenta remitente está correctamente conectada y lista para enviar confirmaciones de citas.
          </p>
        </td></tr>
        ${pieLimablue()}
      </table>
    </td></tr>
  </table>
</body></html>`;
}
