/**
 * Plantillas de correo, generación de .ics y helpers NEUTRALES respecto del
 * proveedor de envío. Extraído de mailService.ts (Gmail) para que tanto el
 * transporte Gmail (DEPRECADO) como emailService.ts (Resend) reutilicen el
 * MISMO HTML y el mismo .ics. Nada aquí conoce Gmail, OAuth ni Resend.
 */
import fs from 'fs';
import path from 'path';
import { citaInicioUtc } from '../utils/fechaLima';

// ─── Logo de la cabecera de los correos ───────────────────────────────────────
// Los clientes de correo NO renderizan SVG ni rutas locales con fiabilidad, así que
// el logo se INCRUSTA por CID (Content-ID): se adjunta el PNG/JPG y el HTML lo
// referencia con `cid:logo-limablue`. Coloca tu logo en:
//   apps/api/assets/correo/logo-correo.png   (o .jpg / .jpeg)
// Si no hay archivo, cae a MAIL_LOGO_URL (URL pública) y, si tampoco, al wordmark.
export const LOGO_CID = 'logo-limablue';

function rutaLogoCorreo(): string | null {
  const dir = path.join(__dirname, '../../assets/correo');
  for (const f of ['logo-correo.png', 'logo-correo.jpg', 'logo-correo.jpeg']) {
    const p = path.join(dir, f);
    try { if (fs.existsSync(p)) return p; } catch { /* noop */ }
  }
  return null;
}

/** Devuelve el archivo del logo listo para adjuntar (base64 + mime), o null. */
export function logoAdjunto(): { mime: string; base64: string } | null {
  const p = rutaLogoCorreo();
  if (!p) return null;
  try {
    const mime = p.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return { mime, base64: fs.readFileSync(p).toString('base64') };
  } catch { return null; }
}

/**
 * Reemplaza la referencia `cid:logo-limablue` por un data-URI con el logo real, para
 * PREVISUALIZAR el correo en un iframe (donde `cid:` no resuelve). SOLO para preview:
 * el envío real conserva el CID (compatible con Gmail/Outlook, que sí resuelven el
 * adjunto inline). Si no hay archivo de logo, deja el HTML tal cual.
 */
export function inlineLogoParaPreview(html: string): string {
  const logo = logoAdjunto();
  if (!logo) return html;
  const dataUri = `data:${logo.mime};base64,${logo.base64}`;
  return html.split(`cid:${LOGO_CID}`).join(dataUri);
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

// ─── Direcciones enviables ────────────────────────────────────────────────────
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

// ─── Fechas en español ────────────────────────────────────────────────────────
// Nombres en español para formatear fechas sin depender de date-fns-tz (que tiene
// una incompatibilidad de versión en este monorepo). La fecha de la cita es @db.Date
// (medianoche UTC), así que usamos getters UTC para no desfasar el día.
const DIAS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Devuelve, p.ej., "lunes 16 de junio 2026". */
export function formatFechaLargaEs(fecha: Date): string {
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
export function urlMapaDireccion(direccion: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}`;
}

export function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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

export interface DatosIcs {
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
  const inicioUtc = citaInicioUtc(cita.fecha, cita.horaInicio);
  const finUtc = new Date(inicioUtc.getTime() + (cita.servicio.duracionMinutos || 30) * 60000);

  // Nunca incluimos el nombre del profesional en el .ics ni en el enlace de
  // Google Calendar: el paciente no debe ver qué especialista lo atenderá.
  const descripcion = [
    `Servicio: ${cita.servicio.nombre}`,
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

// ─── Plantillas HTML ────────────────────────────────────────────────────────
export interface DatosPlantilla {
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
          <div style="color:#ffffff;font-size:13px;margin-top:6px;">${d.servicio} · ${d.sede}</div>
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

// ─── Módulo Videos por Servicio ───────────────────────────────────────────────
/**
 * Sustituye las variables {paciente} / {servicio} / {fecha} en un texto (asunto,
 * título o cuerpo del correo de video). Case-insensitive, tolera espacios: {  fecha }.
 */
export function aplicarVariablesVideo(
  texto: string,
  vars: { paciente: string; servicio: string; fecha: string },
): string {
  return texto
    .replace(/\{\s*paciente\s*\}/gi, vars.paciente)
    .replace(/\{\s*servicio\s*\}/gi, vars.servicio)
    .replace(/\{\s*fecha\s*\}/gi, vars.fecha);
}

export interface DatosPlantillaVideo {
  nombrePaciente: string;
  /** Título mostrado como encabezado del cuerpo (ya con variables sustituidas). */
  tituloVideo: string;
  /** Texto corto del correo (ya con variables sustituidas). */
  cuerpoTexto: string;
  /** URL del thumbnail vertical 9:16 (oardefault) del video. */
  thumbnailUrl: string;
  /** Enlace público de YouTube al que abre el thumbnail (shorts/ o watch?v=). */
  urlVideo: string;
}

/**
 * Correo de video educativo. Mismo shell visual que los correos de cita
 * (headerNuevo/pieNuevo, logo por CID, tablas + estilos inline email-safe).
 *
 * El bloque central es un thumbnail VERTICAL 9:16 con un botón de play superpuesto
 * (técnica de overlay con `background` en <td> + fallback VML para Outlook, sin CSS
 * moderno que Gmail recorte). TODO el bloque es un enlace a YouTube: en móvil abre el
 * reproductor a pantalla completa. Debajo, un botón secundario "▶ Ver video" por si la
 * imagen no carga.
 */
export function renderPlantillaVideo(d: DatosPlantillaVideo): string {
  const W = 280;               // ancho del thumbnail
  const H = Math.round((W * 16) / 9); // 9:16 → 498
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#e7e5df;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e7e5df;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(16,40,79,.12),0 14px 50px rgba(16,40,79,.12);">
        <!-- Cabecera COMPACTA (propia del correo de video): banner bajo + logo chico,
             para que parte del thumbnail asome sin necesidad de hacer scroll. -->
        <tr><td style="background:#1e3a8a;padding:9px 32px;text-align:center;font-family:'Manrope',Arial,Helvetica,sans-serif;">
          ${logoMarcaHtml(88)}
        </td></tr>
        <tr><td style="padding:16px 32px 22px;font-family:'Manrope',Arial,Helvetica,sans-serif;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:10px;"><tr>
            <td style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:999px;padding:5px 12px;">
              <span style="color:#1e40af;font-size:12px;font-weight:700;letter-spacing:.02em;">▶&nbsp; Video para ti</span>
            </td>
          </tr></table>
          <p style="margin:0 0 3px;font-size:14px;line-height:1.5;color:#4b5563;">Hola ${d.nombrePaciente} 👋</p>
          <h1 style="margin:0 0 5px;font-size:19px;font-weight:800;color:#0f1f3d;letter-spacing:-.02em;line-height:1.25;">${d.tituloVideo}</h1>
          <p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:#4b5563;">${d.cuerpoTexto}</p>

          <!-- Thumbnail vertical 9:16 con play superpuesto. Todo el bloque es un enlace. -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
            <a href="${d.urlVideo}" target="_blank" style="text-decoration:none;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="${W}" style="width:${W}px;border-radius:14px;overflow:hidden;">
                <tr><td background="${d.thumbnailUrl}" width="${W}" height="${H}" valign="middle" align="center"
                  style="width:${W}px;height:${H}px;background-image:url('${d.thumbnailUrl}');background-size:cover;background-position:center;background-color:#0f1f3d;border-radius:14px;">
                  <!--[if mso]>
                  <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:${W}px;height:${H}px;">
                    <v:fill type="frame" src="${d.thumbnailUrl}" color="#0f1f3d" />
                    <v:textbox inset="0,0,0,0"><center>
                  <![endif]-->
                  <!-- botón de play (círculo blanco con triángulo azul) -->
                  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                    <td width="66" height="66" align="center" valign="middle"
                      style="width:66px;height:66px;background:#ffffff;border-radius:50%;box-shadow:0 4px 14px rgba(0,0,0,.35);">
                      <span style="color:#1e3a8a;font-size:26px;line-height:66px;">&#9654;</span>
                    </td>
                  </tr></table>
                  <!--[if mso]></center></v:textbox></v:rect><![endif]-->
                </td></tr>
              </table>
            </a>
          </td></tr></table>

          <!-- botón secundario (fallback si el thumbnail no carga) -->
          <a href="${d.urlVideo}" target="_blank" style="display:block;margin-top:20px;background:#1e3a8a;color:#ffffff;text-decoration:none;text-align:center;font-size:15px;font-weight:700;padding:14px;border-radius:10px;">▶ Ver video</a>
        </td></tr>
        ${pieNuevo()}
      </table>
    </td></tr>
  </table>
</body></html>`;
}

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
