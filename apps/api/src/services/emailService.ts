/**
 * Servicio de correo — Resend como ÚNICO proveedor de envío.
 *
 * - API key SOLO desde process.env.RESEND_API_KEY. NUNCA hardcodeada, NUNCA en
 *   base de datos, NUNCA expuesta en un endpoint ni en la UI.
 * - El remitente (correo + nombre) se lee de la configuración en BD (MailConfig),
 *   con default "Limablue Podología <citas@limablue.pe>".
 * - Cada envío devuelve el id de Resend.
 * - Un fallo de correo NUNCA rompe el flujo de agendamiento: si la key no está
 *   presente se loguea un warning claro y se OMITE el envío (devuelve null); si
 *   Resend responde error, se lanza para que el llamador (fire-and-forget) lo
 *   registre sin bloquear la cita.
 *
 * Las plantillas HTML y el .ics viven en emailTemplates.ts (neutrales respecto
 * del proveedor) y se reutilizan tal cual desde Gmail (DEPRECADO) y Resend.
 */
import { Resend } from 'resend';
import { prisma } from '../db';
import {
  logoAdjunto,
  LOGO_CID,
  esEmailEnviable,
  formatFechaLargaEs,
  capitalizar,
  urlMapaDireccion,
  construirUrlGoogleCalendarDeCita,
  construirIcsDeCita,
  renderPlantillaReserva,
  renderPlantillaRecordatorio,
} from './emailTemplates';

const REMITENTE_DEFAULT_EMAIL = 'citas@limablue.pe';
const REMITENTE_DEFAULT_NOMBRE = 'Limablue Podología';

/**
 * Modo prueba: NO envía correos reales pero deja correr toda la lógica previa (incl. la
 * cuota diaria). Env-gated, default FALSE. Solo para entornos de prueba (Gate 0); NUNCA prod.
 */
export const MAIL_DRY_RUN = process.env.MAIL_DRY_RUN === 'true';
if (MAIL_DRY_RUN) {
  console.warn('⚠️  MAIL_DRY_RUN ACTIVO — los correos NO se envían (modo prueba). No debe estar activo en producción.');
}

/** ¿Está Resend configurado para enviar? (o dry-run activo, para ejercer la lógica de cuota). */
export function resendConfigurado(): boolean {
  return MAIL_DRY_RUN || !!process.env.RESEND_API_KEY?.trim();
}

// Cliente Resend perezoso: se crea al primer envío, no al importar el módulo,
// para no exigir la key en procesos que no envían correo (scripts, tests).
let _resend: Resend | null = null;
function cliente(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

/**
 * Remitente "Nombre <correo>" leído de la config activa en BD, con default
 * "Limablue Podología <citas@limablue.pe>". El dominio debe estar verificado en
 * Resend (limablue.pe) para que el envío no rebote.
 */
export async function getRemitente(): Promise<string> {
  const cfg = await prisma.mailConfig.findFirst({
    where: { isActive: true },
    orderBy: { actualizadoEn: 'desc' },
  });
  const email = cfg?.fromEmail?.trim() || process.env.MAIL_FROM_ADDRESS?.trim() || REMITENTE_DEFAULT_EMAIL;
  const nombre = cfg?.fromName?.trim() || process.env.MAIL_FROM_NAME?.trim() || REMITENTE_DEFAULT_NOMBRE;
  return `${nombre} <${email}>`;
}

/** Adjunto de calendario opcional (mismo shape que usaba el transporte Gmail). */
export interface AdjuntoIcs {
  filename: string;
  /** Contenido del archivo .ics ya formateado (texto iCalendar). */
  contenido: string;
  /** PUBLISH (agregar sin RSVP) | REQUEST (invitación) | CANCEL. Por defecto PUBLISH. */
  method?: 'PUBLISH' | 'REQUEST' | 'CANCEL';
}

export interface EnviarEmailArgs {
  to: string;
  subject: string;
  html: string;
  /** Adjunto de calendario opcional. Si viene, se envía como attachment del correo. */
  ics?: AdjuntoIcs;
}

/**
 * Envía un correo vía Resend. Devuelve `{ id }` con el id de Resend, o `null` si
 * el envío se OMITIÓ por falta de RESEND_API_KEY (no lanza en ese caso: el flujo
 * de agendamiento continúa). Lanza solo si Resend responde con error.
 *
 * El logo de la cabecera (si hay archivo en assets/correo) se adjunta INLINE con
 * `contentId = logo-limablue`, que las plantillas referencian vía `cid:logo-limablue`.
 */
export async function enviarEmail({ to, subject, html, ics }: EnviarEmailArgs): Promise<{ id: string } | null> {
  if (MAIL_DRY_RUN) {
    // Dry-run: se saltó el envío real a Resend, pero la cuota ya se reservó aguas arriba.
    return { id: `dry-run-${Date.now()}` };
  }
  if (!resendConfigurado()) {
    console.warn(`[email] RESEND_API_KEY ausente en el entorno — envío OMITIDO (destinatario ${to}). El flujo continúa sin correo.`);
    return null;
  }

  const from = await getRemitente();

  // Adjuntos: logo inline (cid) + .ics si viene. Resend acepta `content` como Buffer.
  const attachments: { filename: string; content: Buffer; contentType?: string; contentId?: string }[] = [];

  const logo = logoAdjunto();
  if (logo) {
    attachments.push({
      filename: 'logo-limablue' + (logo.mime === 'image/png' ? '.png' : '.jpg'),
      content: Buffer.from(logo.base64, 'base64'),
      contentType: logo.mime,
      contentId: LOGO_CID,
    });
  }

  if (ics) {
    attachments.push({
      filename: ics.filename,
      content: Buffer.from(ics.contenido, 'utf-8'),
      // El method en el content-type es lo que hace que Outlook/Gmail traten el
      // .ics como invitación (REQUEST/CANCEL) o como "agregar al calendario" (PUBLISH).
      contentType: `text/calendar; charset=UTF-8; method=${ics.method ?? 'PUBLISH'}`,
    });
  }

  const { data, error } = await cliente().emails.send({
    from,
    to,
    subject,
    html,
    ...(attachments.length ? { attachments } : {}),
  });

  if (error) {
    throw new Error(`Resend rechazó el envío a ${to}: ${error.name ?? ''} ${error.message ?? ''}`.trim());
  }
  if (!data?.id) {
    throw new Error(`Resend no devolvió id de correo para ${to}`);
  }
  return { id: data.id };
}

// ─── Estado del dominio de envío (Resend) ────────────────────────────────────
/** Dominio verificado en Resend desde el que se envían los correos. */
export const DOMINIO_ENVIO = 'limablue.pe';

export type EstadoDominio = 'verified' | 'pending' | 'failed';
export interface DominioInfo {
  dominio: string;
  /** verified/pending/failed, o null si la key no puede LEER el estado del dominio. */
  estado: EstadoDominio | null;
  region: string | null;
  /** ¿La API key pudo consultar el estado del dominio (permiso de lectura de domains)? */
  consultable: boolean;
  /** Explicación cuando no es consultable (p. ej. key de solo envío). */
  motivo?: string;
}

// Caché en memoria (5 min) para no consultar la API de Resend en cada carga de la
// pantalla de configuración. Se refresca solo tras expirar el TTL.
const DOMINIO_TTL_MS = 5 * 60_000;
let _dominioCache: { data: DominioInfo; ts: number } | null = null;

/** ¿El error de Resend es por permisos de la key (p. ej. key de solo envío)? */
function esErrorDePermiso(msg: string): boolean {
  return /restricted|not allowed|permission|unauthorized|forbidden|access denied/i.test(msg);
}

/**
 * Consulta el estado del dominio de envío en Resend (GET domains) y lo reduce a
 * verified / pending / failed + región. Cacheado en memoria 5 min. Asume que la
 * API key está presente (el endpoint que lo llama valida `resendConfigurado()`).
 * La API key NUNCA sale de aquí.
 *
 * Si la key es de SOLO ENVÍO (no puede leer domains), degrada a `consultable:false`
 * en vez de fallar — el estado de dominio no es consultable, pero el envío funciona.
 * Un error REAL (red, etc.) se relanza para que el endpoint responda 502.
 */
export async function estadoDominio(): Promise<DominioInfo> {
  if (_dominioCache && Date.now() - _dominioCache.ts < DOMINIO_TTL_MS) {
    return _dominioCache.data;
  }

  let info: DominioInfo;
  try {
    const { data, error } = await cliente().domains.list();
    if (error) throw new Error(error.message ?? 'Resend domains.list falló');

    const dom = data?.data?.find((d) => d.name.toLowerCase() === DOMINIO_ENVIO);
    const estado: EstadoDominio = !dom
      ? 'failed' // el dominio no aparece en la cuenta de Resend → tratarlo como fallo
      : dom.status === 'verified'
        ? 'verified'
        : dom.status === 'failed' || dom.status === 'partially_failed'
          ? 'failed'
          : 'pending'; // pending | not_started | partially_verified

    info = { dominio: DOMINIO_ENVIO, estado, region: dom?.region ?? null, consultable: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!esErrorDePermiso(msg)) throw e; // error real → 502 en el endpoint
    // Key de solo envío: el estado no es consultable, pero el envío sí funciona.
    info = {
      dominio: DOMINIO_ENVIO,
      estado: null,
      region: null,
      consultable: false,
      motivo: 'La API key de Resend es de solo envío; no puede leer el estado del dominio.',
    };
  }

  _dominioCache = { data: info, ts: Date.now() };
  return info;
}

/** Correo remitente "pelado" (solo la dirección), p. ej. para el ORGANIZER del .ics. */
export async function getRemitenteEmail(): Promise<string> {
  const cfg = await prisma.mailConfig.findFirst({
    where: { isActive: true },
    orderBy: { actualizadoEn: 'desc' },
  });
  return cfg?.fromEmail?.trim() || process.env.MAIL_FROM_ADDRESS?.trim() || REMITENTE_DEFAULT_EMAIL;
}

// ─── Correos de cita (reserva / recordatorio) sobre Resend ───────────────────
// Reutilizan EXACTAMENTE las plantillas y el .ics de emailTemplates.ts. Las
// fechas civiles se arman en el template con getters UTC sobre @db.Date (sin
// conversión de zona horaria): la fecha mostrada es la fecha civil de Lima.
async function cargarCitaCorreo(citaId: string) {
  const cita = await prisma.cita.findUnique({
    where: { id: citaId },
    include: { paciente: true, profesional: true, sede: true, servicio: true },
  });
  if (!cita) throw new Error('Cita no encontrada');
  if (!cita.paciente.email) throw new Error('El paciente no tiene correo registrado.');
  // CAPA 5.3: correo marcado inválido por rebote/queja previa (webhook Resend) → NO enviar.
  if (cita.paciente.emailInvalido) {
    console.warn(`[email] Paciente ${cita.paciente.id} tiene emailInvalido=true (rebote/queja previa) — envío OMITIDO a ${cita.paciente.email}.`);
    throw new Error(`Correo marcado inválido por rebote/queja previa: ${cita.paciente.email}`);
  }
  if (!esEmailEnviable(cita.paciente.email)) {
    throw new Error(`Correo no enviable: ${cita.paciente.email}`);
  }
  return cita;
}

/** Correo 1 — "Tu cita quedó registrada". Devuelve el id de Resend (o null si se omitió). */
export async function enviarCorreoReserva(citaId: string): Promise<{ to: string; id: string | null }> {
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

  const res = await enviarEmail({
    to: cita.paciente.email!,
    subject: `Tu cita en Limablue quedó registrada · ${fechaLarga}`,
    html,
  });
  return { to: cita.paciente.email!, id: res?.id ?? null };
}

/** Correo 2 — recordatorio con .ics + botones confirmar/reprogramar. Devuelve el id de Resend. */
export async function enviarCorreoRecordatorio(args: {
  citaId: string;
  urlConfirmar: string;
  urlReprogramar: string;
}): Promise<{ to: string; id: string | null }> {
  const cita = await cargarCitaCorreo(args.citaId);
  const fechaLarga = capitalizar(formatFechaLargaEs(cita.fecha));
  const profesional = cita.profesional ? `${cita.profesional.nombres} ${cita.profesional.apellidos}` : null;

  const citaIcs = {
    id: cita.id, fecha: cita.fecha, horaInicio: cita.horaInicio,
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

  const res = await enviarEmail({
    to: cita.paciente.email!,
    subject: `Recordatorio de tu cita en Limablue · ${fechaLarga} ${cita.horaInicio}`,
    html,
    ics: { filename: 'cita-limablue.ics', contenido: construirIcsDeCita(citaIcs) },
  });
  return { to: cita.paciente.email!, id: res?.id ?? null };
}
