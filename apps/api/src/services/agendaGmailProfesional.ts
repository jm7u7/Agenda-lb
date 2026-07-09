/**
 * Notificación de citas a la AGENDA PERSONAL (Gmail) de una profesional.
 *
 * Algunas profesionales usan una cuenta de Gmail gratuita (no Workspace), a la
 * que Microsoft Graph NO puede escribir (no está en el tenant de la clínica).
 * Para ellas replicamos la cita por CORREO con una invitación iCalendar
 * (METHOD:REQUEST), que Gmail/Google Calendar agrega, actualiza o elimina solo:
 *   - crear/actualizar → REQUEST (mismo UID; SEQUENCE creciente = se actualiza)
 *   - cancelar         → CANCEL  (elimina el evento del calendario)
 *
 * Es NO BLOQUEANTE: si el envío falla, lo orquesta `sincronizarCitaOutlook`
 * (deja `outlookSyncError` para que el reintentador lo reprocese).
 */
import { prisma } from '../db';
import { redis } from '../redis';
import { citaInicioUtc } from '../utils/fechaLima';
import { enviarEmail, resendConfigurado, getRemitenteEmail } from './emailService';
import { construirIcsAvanzado } from './emailTemplates';

// El destino de la invitación .ics (antes hardcodeado a un Gmail) ahora se lee de
// Profesional.emailAgenda en BD (ver outlookCalendarService). Yasica Doy →
// yasicadoy@limablue.com (Microsoft 365). Daniel Doy se sincroniza por Graph.

export type AccionCita = 'crear' | 'actualizar' | 'cancelar';

/** Cita con las relaciones mínimas para armar la invitación. */
export interface CitaParaGmailProf {
  id: string;
  fecha: Date;
  horaInicio: string;
  duracionMinutos: number;
  paciente: { nombres: string; apellidoPaterno: string };
  sede: { nombre: string; direccion: string };
  servicio: { nombre: string; duracionMinutos: number };
}

/**
 * SEQUENCE iCalendar por cita (Redis). Debe crecer en cada envío para que
 * Google reconozca la actualización en vez de duplicar el evento.
 */
async function siguienteSequence(citaId: string): Promise<number> {
  const key = `mail:icsseq:${citaId}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, 400 * 24 * 3600); // cubre citas a futuro
  return n - 1; // primera vez → 0
}

function datosEvento(cita: CitaParaGmailProf) {
  const inicioUtc = citaInicioUtc(cita.fecha, cita.horaInicio);
  const dur = cita.servicio.duracionMinutos || cita.duracionMinutos || 30;
  const finUtc = new Date(inicioUtc.getTime() + dur * 60000);
  const paciente = `${cita.paciente.nombres} ${cita.paciente.apellidoPaterno}`.trim();
  return {
    paciente,
    inicioUtc,
    finUtc,
    // UID propio (prefijo "prof") para no colisionar con el .ics del paciente.
    uid: `cita-prof-${cita.id}@limablue.pe`,
    titulo: `Cita: ${paciente} — ${cita.servicio.nombre}`,
    descripcion: [
      `Paciente: ${paciente}`,
      `Servicio: ${cita.servicio.nombre}`,
      `Sede: ${cita.sede.nombre}`,
    ].join('\n'),
    ubicacion: `${cita.sede.nombre} — ${cita.sede.direccion}`,
  };
}

function formatoFechaHora(inicioUtc: Date): string {
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima', weekday: 'long', day: '2-digit', month: 'long',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(inicioUtc);
}

function asuntoYHtml(accion: AccionCita, d: ReturnType<typeof datosEvento>) {
  const cuando = formatoFechaHora(d.inicioUtc);
  const etiqueta = accion === 'cancelar' ? 'Cita cancelada' : accion === 'actualizar' ? 'Cita reprogramada' : 'Nueva cita';
  const color = accion === 'cancelar' ? '#b91c1c' : '#1e3a8a';
  const subject = `${etiqueta} · ${d.paciente} · ${cuando}`;
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;">
    <tr><td style="background:${color};padding:16px 24px;color:#fff;font-size:16px;font-weight:700;">${etiqueta}</td></tr>
    <tr><td style="padding:24px;">
      <p style="margin:0 0 14px;font-size:15px;">Paciente: <strong>${d.paciente}</strong></p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
        <tr><td style="padding:6px 0;color:#64748b;">Fecha y hora</td><td align="right" style="font-weight:700;">${cuando}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Sede</td><td align="right" style="font-weight:700;">${d.ubicacion}</td></tr>
      </table>
      <p style="margin:18px 0 0;font-size:12px;color:#94a3b8;">${accion === 'cancelar'
        ? 'Esta cita se eliminó de tu Google Calendar automáticamente.'
        : 'Esta cita se agregó/actualizó en tu Google Calendar automáticamente.'}</p>
    </td></tr>
  </table>
</body></html>`;
  return { subject, html };
}

/**
 * Envía/actualiza/cancela la cita en la agenda Gmail de la profesional.
 * Lanza si el envío falla (el orquestador registra el error para reintento).
 */
export async function notificarCitaGmailProfesional(
  accion: AccionCita,
  cita: CitaParaGmailProf,
  gmailDestino: string,
): Promise<void> {
  if (!resendConfigurado()) {
    console.warn('[agenda .ics] RESEND_API_KEY ausente — invitación de cita omitida (Yasica Doy). El flujo continúa.');
    return; // sin Resend configurado: inerte (igual que Outlook sin Azure)
  }

  const cancelar = accion === 'cancelar';
  const d = datosEvento(cita);
  const sequence = await siguienteSequence(cita.id);
  const fromEmail = await getRemitenteEmail();

  const ics = construirIcsAvanzado(
    { uid: d.uid, inicioUtc: d.inicioUtc, finUtc: d.finUtc, titulo: d.titulo, descripcion: d.descripcion, ubicacion: d.ubicacion },
    {
      metodo: cancelar ? 'CANCEL' : 'REQUEST',
      status: cancelar ? 'CANCELLED' : 'CONFIRMED',
      sequence,
      organizer: fromEmail ?? undefined,
      attendee: { email: gmailDestino, nombre: 'Yasica Doy' },
    },
  );

  const { subject, html } = asuntoYHtml(accion, d);
  await enviarEmail({ to: gmailDestino, subject, html, ics: { filename: 'cita-limablue.ics', contenido: ics, method: cancelar ? 'CANCEL' : 'REQUEST' } });

  // Éxito: limpiar marca de error para que el reintentador no lo repita.
  await prisma.cita.update({ where: { id: cita.id }, data: { outlookSyncError: null } }).catch(() => { /* noop */ });
}

// ── Reuniones administrativas (BloqueoAgenda esReunion) → Gmail de Yasica ──────
/** Bloqueo-reunión con lo mínimo para armar la invitación a la agenda Gmail. */
export interface ReunionParaGmailProf {
  id: string;
  fechaInicio: Date;  // su UTC Y/M/D es el día de la reunión (proceso en TZ=UTC)
  horaInicio: string; // "HH:mm" (hora Lima)
  horaFin: string;    // "HH:mm"
  motivo: string;
}

/** Envía/actualiza/cancela una REUNIÓN en la agenda Gmail de la profesional (mismo
 *  mecanismo .ics que las citas, UID propio "reunion-prof-…"). Lanza si el envío falla. */
export async function notificarReunionGmailProfesional(
  accion: AccionCita,
  bloqueo: ReunionParaGmailProf,
  gmailDestino: string,
): Promise<void> {
  if (!resendConfigurado()) {
    console.warn('[agenda .ics] RESEND_API_KEY ausente — invitación de reunión omitida (Yasica Doy). El flujo continúa.');
    return; // sin Resend configurado: inerte
  }

  const cancelar = accion === 'cancelar';
  const inicioUtc = citaInicioUtc(bloqueo.fechaInicio, bloqueo.horaInicio);
  const finUtc = citaInicioUtc(bloqueo.fechaInicio, bloqueo.horaFin);
  const uid = `reunion-prof-${bloqueo.id}@limablue.pe`;
  const titulo = `Reunión: ${bloqueo.motivo}`;
  const descripcion = `Reunión administrativa Limablue\n${bloqueo.motivo}`;
  const sequence = await siguienteSequence(`reunion-${bloqueo.id}`);
  const fromEmail = await getRemitenteEmail();

  const ics = construirIcsAvanzado(
    { uid, inicioUtc, finUtc, titulo, descripcion, ubicacion: 'Limablue' },
    {
      metodo: cancelar ? 'CANCEL' : 'REQUEST',
      status: cancelar ? 'CANCELLED' : 'CONFIRMED',
      sequence,
      organizer: fromEmail ?? undefined,
      attendee: { email: gmailDestino, nombre: 'Yasica Doy' },
    },
  );

  const cuando = formatoFechaHora(inicioUtc);
  const etiqueta = cancelar ? 'Reunión cancelada' : accion === 'actualizar' ? 'Reunión actualizada' : 'Reunión';
  const color = cancelar ? '#b91c1c' : '#166534';
  const subject = `${etiqueta} · ${bloqueo.motivo} · ${cuando}`;
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;">
    <tr><td style="background:${color};padding:16px 24px;color:#fff;font-size:16px;font-weight:700;">🤝 ${etiqueta}</td></tr>
    <tr><td style="padding:24px;">
      <p style="margin:0 0 14px;font-size:15px;"><strong>${bloqueo.motivo}</strong></p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
        <tr><td style="padding:6px 0;color:#64748b;">Fecha y hora</td><td align="right" style="font-weight:700;">${cuando}</td></tr>
      </table>
      <p style="margin:18px 0 0;font-size:12px;color:#94a3b8;">${cancelar
        ? 'Esta reunión se eliminó de tu Google Calendar automáticamente.'
        : 'Esta reunión se agregó/actualizó en tu Google Calendar automáticamente.'}</p>
    </td></tr>
  </table>
</body></html>`;

  await enviarEmail({ to: gmailDestino, subject, html, ics: { filename: 'reunion-limablue.ics', contenido: ics, method: cancelar ? 'CANCEL' : 'REQUEST' } });
  await prisma.bloqueoAgenda.update({ where: { id: bloqueo.id }, data: { outlookSyncError: null } }).catch(() => { /* noop */ });
}
