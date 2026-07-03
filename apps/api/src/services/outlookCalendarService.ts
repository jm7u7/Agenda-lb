/**
 * Sincronización de la agenda de las profesionales Doy. Punto único de entrada:
 * `sincronizarCitaOutlook` decide el canal según la profesional:
 *   - Daniel Doy  → buzón Outlook (Microsoft Graph) en danieldoy@limablue.com.
 *   - Yasica Doy  → su Gmail personal por correo con invitación (.ics), porque
 *                   Graph no puede escribir en un buzón externo (ver
 *                   agendaGmailProfesional).
 * Es NO BLOQUEANTE: si falla, la cita igual queda en BD y se registra el error en
 * `cita.outlookSyncError` para que el reintentador lo reprocese (cualquier canal).
 *
 * El canal Outlook requiere una app registrada en Azure AD / Entra ID con permiso
 * de APLICACIÓN `Calendars.ReadWrite` (con consentimiento de admin) y estas
 * variables de entorno: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET.
 * Si faltan, el canal Outlook queda inerte (no rompe nada).
 */
import { prisma } from '../db';
import { gmailDeProfesional, notificarCitaGmailProfesional, notificarReunionGmailProfesional } from './agendaGmailProfesional';

const TZ = 'America/Lima';
const tenantId = () => process.env.AZURE_TENANT_ID;
const clientId = () => process.env.AZURE_CLIENT_ID;
const clientSecret = () => process.env.AZURE_CLIENT_SECRET;

export function outlookConfigurado(): boolean {
  return !!(tenantId() && clientId() && clientSecret());
}

// ── Mapeo profesional → buzón Outlook (solo Daniel Doy) ────────────────────────
// Yasica Doy se notifica por Gmail (ver agendaGmailProfesional), no por Graph.
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export function emailOutlookDeProfesional(nombres: string, apellidos: string): string | null {
  const n = norm(`${nombres} ${apellidos}`);
  if (n.includes('doy') && n.includes('daniel')) return 'danieldoy@limablue.com';
  return null;
}

// ── Token (client credentials), cacheado ~1h ───────────────────────────────────
let cachedToken: { value: string; exp: number } | null = null;

async function obtenerToken(): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.value;
  const url = `https://login.microsoftonline.com/${tenantId()}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId()!,
    client_secret: clientSecret()!,
    grant_type: 'client_credentials',
    scope: 'https://graph.microsoft.com/.default',
  });
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) throw new Error(`Token Graph ${res.status}: ${await res.text()}`);
  const data = await res.json() as { access_token: string; expires_in?: number };
  cachedToken = { value: data.access_token, exp: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

async function graph(method: 'POST' | 'PATCH' | 'DELETE', path: string, payload?: unknown): Promise<any> {
  const token = await obtenerToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  if (!res.ok) throw new Error(`Graph ${method} ${path} → ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// ── Construcción del evento Graph ───────────────────────────────────────────────
export interface CitaParaOutlook {
  pacienteNombre: string;
  servicioNombre: string;
  sedeNombre: string;
  fecha: string;          // YYYY-MM-DD
  horaInicio: string;     // HH:mm
  duracionMinutos: number;
}

function sumarMinutos(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m + mins;
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function eventoPayload(c: CitaParaOutlook) {
  return {
    subject: `Cita: ${c.pacienteNombre} — ${c.servicioNombre}`,
    body: { contentType: 'HTML', content: `Sede: ${c.sedeNombre}` },
    start: { dateTime: `${c.fecha}T${c.horaInicio}:00`, timeZone: TZ },
    end: { dateTime: `${c.fecha}T${sumarMinutos(c.horaInicio, c.duracionMinutos)}:00`, timeZone: TZ },
    location: { displayName: c.sedeNombre },
    reminderMinutesBeforeStart: 30,
    isReminderOn: true,
  };
}

// ── CRUD de eventos ─────────────────────────────────────────────────────────────
export async function crearEvento(userEmail: string, citaData: CitaParaOutlook): Promise<string> {
  const ev = await graph('POST', `/users/${encodeURIComponent(userEmail)}/events`, eventoPayload(citaData));
  return ev.id as string;
}

export async function actualizarEvento(userEmail: string, eventId: string, citaData: CitaParaOutlook): Promise<void> {
  await graph('PATCH', `/users/${encodeURIComponent(userEmail)}/events/${eventId}`, eventoPayload(citaData));
}

export async function eliminarEvento(userEmail: string, eventId: string): Promise<void> {
  await graph('DELETE', `/users/${encodeURIComponent(userEmail)}/events/${eventId}`);
}

// ── Orquestador no bloqueante usado por las rutas ───────────────────────────────
type Accion = 'crear' | 'actualizar' | 'cancelar';

export async function sincronizarCitaOutlook(accion: Accion, citaId: string): Promise<void> {
  try {
    const cita = await prisma.cita.findUnique({
      where: { id: citaId },
      include: { profesional: true, solicitadoProfesional: true, paciente: true, sede: true, servicio: true },
    });
    if (!cita || !cita.profesional) return;

    // Persona REAL que atiende: en baro "Solo X" la cita vive en una MÁQUINA (profesionalId =
    // "Baro 1") y el médico pedido va en solicitadoProfesional — el calendario es el de ESA
    // persona. Sin esto, las baro "Solo Daniel/Yasica" nunca llegaban a su celular.
    const persona = cita.solicitadoProfesional ?? cita.profesional;

    // Yasica Doy → su Gmail personal por correo con invitación (.ics). Graph no
    // puede escribir en un buzón externo, así que se notifica por email.
    const gmailDestino = gmailDeProfesional(persona.nombres, persona.apellidos);
    if (gmailDestino) {
      await notificarCitaGmailProfesional(accion, cita, gmailDestino);
      return;
    }

    // Daniel Doy → buzón Outlook vía Microsoft Graph (requiere credenciales Azure).
    if (!outlookConfigurado()) return; // inerte si no hay credenciales Azure
    const email = emailOutlookDeProfesional(persona.nombres, persona.apellidos);
    if (!email) return; // solo Daniel Doy

    // Cancelar: borrar el evento si existe y limpiar el id.
    if (accion === 'cancelar') {
      if (cita.outlookEventId) {
        await eliminarEvento(email, cita.outlookEventId);
        await prisma.cita.update({ where: { id: citaId }, data: { outlookEventId: null, outlookSyncError: null } });
      }
      return;
    }

    const citaData: CitaParaOutlook = {
      pacienteNombre: `${cita.paciente.nombres} ${cita.paciente.apellidoPaterno}`.trim(),
      servicioNombre: cita.servicio.nombre,
      sedeNombre: cita.sede.nombre,
      fecha: cita.fecha.toISOString().slice(0, 10),
      horaInicio: cita.horaInicio,
      duracionMinutos: cita.duracionMinutos,
    };

    // Idempotente: si ya hay evento, se ACTUALIZA (no se duplica); si no, se crea.
    if (cita.outlookEventId) {
      await actualizarEvento(email, cita.outlookEventId, citaData);
      if (cita.outlookSyncError) await prisma.cita.update({ where: { id: citaId }, data: { outlookSyncError: null } });
    } else {
      const eventId = await crearEvento(email, citaData);
      await prisma.cita.update({ where: { id: citaId }, data: { outlookEventId: eventId, outlookSyncError: null } });
    }
  } catch (e) {
    // No bloquear el flujo; registrar el fallo para reintento posterior.
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[outlook] sync ${accion} cita ${citaId} falló:`, msg);
    try { await prisma.cita.update({ where: { id: citaId }, data: { outlookSyncError: msg.slice(0, 500) } }); } catch { /* noop */ }
  }
}

// ── Reuniones administrativas (BloqueoAgenda esReunion) → agenda del profesional ──
export interface ReunionParaOutlook {
  motivo: string;
  fecha: string;       // YYYY-MM-DD
  horaInicio: string;  // HH:mm
  horaFin: string;     // HH:mm
}

function eventoReunionPayload(r: ReunionParaOutlook) {
  return {
    subject: `Reunión: ${r.motivo}`,
    body: { contentType: 'HTML', content: 'Reunión administrativa · Limablue' },
    start: { dateTime: `${r.fecha}T${r.horaInicio}:00`, timeZone: TZ },
    end: { dateTime: `${r.fecha}T${r.horaFin}:00`, timeZone: TZ },
    location: { displayName: 'Limablue' },
    showAs: 'busy',
    reminderMinutesBeforeStart: 15,
    isReminderOn: true,
  };
}

/**
 * Sincroniza una REUNIÓN (BloqueoAgenda con esReunion=true) con la agenda del profesional:
 * Daniel Doy → su buzón Outlook (Graph); Yasica Doy → su Gmail (.ics). NO bloqueante: si
 * falla, deja `bloqueoAgenda.outlookSyncError` para el reintentador. Solo actúa sobre reuniones.
 */
export async function sincronizarReunionOutlook(accion: Accion, bloqueoId: string): Promise<void> {
  try {
    const b = await prisma.bloqueoAgenda.findUnique({ where: { id: bloqueoId }, include: { profesional: true } });
    if (!b || !b.profesional || !b.esReunion || !b.horaInicio || !b.horaFin) return;
    const fecha = b.fechaInicio.toISOString().slice(0, 10);

    // Yasica Doy → Gmail personal por invitación .ics.
    const gmailDestino = gmailDeProfesional(b.profesional.nombres, b.profesional.apellidos);
    if (gmailDestino) {
      await notificarReunionGmailProfesional(accion, { id: b.id, fechaInicio: b.fechaInicio, horaInicio: b.horaInicio, horaFin: b.horaFin, motivo: b.motivo }, gmailDestino);
      return;
    }

    // Daniel Doy → buzón Outlook vía Microsoft Graph.
    if (!outlookConfigurado()) return;
    const email = emailOutlookDeProfesional(b.profesional.nombres, b.profesional.apellidos);
    if (!email) return;
    const r: ReunionParaOutlook = { motivo: b.motivo, fecha, horaInicio: b.horaInicio, horaFin: b.horaFin };

    if (accion === 'cancelar') {
      if (b.outlookEventId) {
        await eliminarEvento(email, b.outlookEventId);
        await prisma.bloqueoAgenda.update({ where: { id: bloqueoId }, data: { outlookEventId: null, outlookSyncError: null } });
      }
      return;
    }

    // Idempotente: si ya hay evento, se ACTUALIZA; si no, se crea.
    if (b.outlookEventId) {
      await graph('PATCH', `/users/${encodeURIComponent(email)}/events/${b.outlookEventId}`, eventoReunionPayload(r));
      if (b.outlookSyncError) await prisma.bloqueoAgenda.update({ where: { id: bloqueoId }, data: { outlookSyncError: null } });
    } else {
      const ev = await graph('POST', `/users/${encodeURIComponent(email)}/events`, eventoReunionPayload(r));
      await prisma.bloqueoAgenda.update({ where: { id: bloqueoId }, data: { outlookEventId: ev.id as string, outlookSyncError: null } });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[outlook] sync ${accion} reunión ${bloqueoId} falló:`, msg);
    try { await prisma.bloqueoAgenda.update({ where: { id: bloqueoId }, data: { outlookSyncError: msg.slice(0, 500) } }); } catch { /* noop */ }
  }
}

const ESTADOS_CANCELADOS = ['cancelada', 'no_show', 'reprogramada'];

/**
 * Reprocesa las citas cuya última sincronización con Outlook falló
 * (`outlookSyncError != null`). Elige la acción según el estado actual de la cita:
 * cancelada/no-show/reprogramada → borra el evento; el resto → crea/actualiza.
 * `sincronizarCitaOutlook` limpia `outlookSyncError` cuando tiene éxito.
 */
export async function reintentarOutlookFallidos(limite = 50): Promise<{ intentadas: number; ok: number; fallidas: number }> {
  if (!outlookConfigurado()) return { intentadas: 0, ok: 0, fallidas: 0 };

  const citas = await prisma.cita.findMany({
    where: { outlookSyncError: { not: null }, deletedAt: null },
    select: { id: true, estado: true },
    orderBy: { actualizadoEn: 'asc' },
    take: limite,
  });

  let ok = 0, fallidas = 0;
  for (const c of citas) {
    const accion: Accion = ESTADOS_CANCELADOS.includes(c.estado) ? 'cancelar' : 'crear';
    await sincronizarCitaOutlook(accion, c.id);
    const tras = await prisma.cita.findUnique({ where: { id: c.id }, select: { outlookSyncError: true } });
    if (tras?.outlookSyncError) fallidas++; else ok++;
  }

  // Reuniones (BloqueoAgenda) cuya sincronización falló: reintentar crear/actualizar.
  const reuniones = await prisma.bloqueoAgenda.findMany({
    where: { esReunion: true, outlookSyncError: { not: null }, deletedAt: null },
    select: { id: true },
    orderBy: { actualizadoEn: 'asc' },
    take: limite,
  });
  for (const b of reuniones) {
    await sincronizarReunionOutlook('crear', b.id);
    const tras = await prisma.bloqueoAgenda.findUnique({ where: { id: b.id }, select: { outlookSyncError: true } });
    if (tras?.outlookSyncError) fallidas++; else ok++;
  }

  return { intentadas: citas.length + reuniones.length, ok, fallidas };
}
