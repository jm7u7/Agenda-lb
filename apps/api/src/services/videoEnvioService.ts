/**
 * Módulo "Videos por Servicio" — motor de programación y envío.
 *
 * - Los envíos se REGISTRAN al crear/reprogramar la cita (VideoEnvioLog PENDIENTE),
 *   con `scheduledFor` = inicio de la cita (America/Lima → UTC) ± offset del video.
 * - Un barrido BullMQ cada 5 min (ver queue/videoQueue) los envía cuando vencen,
 *   revalidando en el momento (R1). Idempotencia por índice único parcial (cita,video).
 * - Correo vía Resend (emailService) — NO toca mail_config ni tokens OAuth.
 *
 * Reglas de negocio (confirmadas):
 *   R1 Revalidación al vuelo antes de enviar (cita válida, video activo, email enviable).
 *   R2 Al reprogramar: ENVIADO no se reenvía; CANCELADO "fuera_de_ventana" se reactiva
 *      si la nueva fecha lo vuelve futuro.
 *   R3 Backfill a citas futuras al crear/activar un video.
 *   R4 Editar momento/offset recalcula los logs no enviados del video.
 */
import { prisma } from '../db';
import { enviarEmail, resendConfigurado } from './emailService';
import {
  renderPlantillaVideo,
  aplicarVariablesVideo,
  esEmailEnviable,
  formatFechaLargaEs,
  capitalizar,
} from './emailTemplates';
import {
  esShort,
  urlPublicaYoutube,
  thumbnailVertical,
} from '../utils/youtube';
import { citaInicioUtc } from '../utils/fechaLima';
import { registrarAudit } from './audit';
import type { MomentoVideo, UnidadOffset, ServicioVideo } from '@prisma/client';

const ESTADOS_INACTIVOS = ['cancelada', 'no_show', 'reprogramada'];
const MAX_INTENTOS = 3;
const VENTANA_TOLERANCIA_MS = 6 * 60 * 60_000; // 6 h: más viejo que esto → "ventana expirada"
const LOTE_BARRIDO = 40; // lotes pequeños (límites de envío)

// Motivos de cancelación (columna motivoCancelacion). Solo "fuera_de_ventana" es reactivable.
export const MOTIVO = {
  FUERA_VENTANA: 'fuera_de_ventana',
  CITA_CANCELADA: 'cita_cancelada',
  VIDEO_PAUSADO: 'video_pausado',
  VIDEO_ELIMINADO: 'video_eliminado',
  SIN_EMAIL: 'sin_email',
  // El paciente tuvo una cita MÁS RECIENTE del mismo servicio: el recordatorio "después"
  // se ata solo a la última cita, así que el de la cita anterior se anula.
  SUPERADO: 'superado_por_cita_reciente',
  // El correo está en la lista de exclusión de videos educativos (opt-out).
  OPT_OUT: 'opt_out',
} as const;

/** Normaliza un correo para comparar contra la lista de exclusión (minúsculas, sin espacios). */
function normEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** ¿Este correo está en la lista de exclusión de videos educativos? (activa, no borrada). */
export async function estaSuprimido(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const s = await prisma.videoSupresion.findFirst({
    where: { email: normEmail(email), deletedAt: null },
    select: { id: true },
  });
  return !!s;
}

/** Conjunto de todos los correos excluidos (para el barrido: 1 sola consulta). */
export async function setCorreosSuprimidos(): Promise<Set<string>> {
  const rows = await prisma.videoSupresion.findMany({ where: { deletedAt: null }, select: { email: true } });
  return new Set(rows.map((r) => r.email));
}

/** Al agregar un correo a la lista: cancela sus envíos de video PENDIENTES. */
export async function cancelarVideosPorCorreo(email: string): Promise<number> {
  const r = await prisma.videoEnvioLog.updateMany({
    where: { pacienteEmail: { equals: email, mode: 'insensitive' }, estado: 'PENDIENTE', deletedAt: null },
    data: { estado: 'CANCELADO', motivoCancelacion: MOTIVO.OPT_OUT },
  });
  return r.count;
}

function citaInactiva(estado: string): boolean {
  return ESTADOS_INACTIVOS.includes(estado);
}

function offsetMs(valor: number, unidad: 'HORAS' | 'DIAS'): number {
  return unidad === 'DIAS' ? valor * 86_400_000 : valor * 3_600_000;
}

/**
 * scheduledFor (UTC) = momento de la cita ± offset del video.
 *  - HORAS/DIAS: duración fija en milisegundos.
 *  - MESES/AÑOS: aritmética de CALENDARIO sobre la fecha civil (mismo día del mes/año),
 *    conservando la hora de la cita. "1 año después" cae en la misma fecha del año
 *    siguiente (no 365 días exactos) → sin drift por bisiestos ni meses de distinto largo.
 */
export function calcularScheduledFor(
  fecha: Date,
  horaInicio: string,
  momento: MomentoVideo,
  offsetValor: number,
  offsetUnidad: UnidadOffset,
): Date {
  const signo = momento === 'ANTES' ? -1 : 1;
  if (offsetUnidad === 'HORAS' || offsetUnidad === 'DIAS') {
    const inicio = citaInicioUtc(fecha, horaInicio);
    return new Date(inicio.getTime() + signo * offsetMs(offsetValor, offsetUnidad));
  }
  const civil = new Date(fecha); // @db.Date (mediodía UTC)
  if (offsetUnidad === 'MESES') civil.setUTCMonth(civil.getUTCMonth() + signo * offsetValor);
  else civil.setUTCFullYear(civil.getUTCFullYear() + signo * offsetValor);
  return citaInicioUtc(civil, horaInicio);
}

/**
 * Límite inferior de fecha civil de cita a considerar en el backfill de un video.
 * Para videos DESPUÉS con offset largo (meses/años) hay que mirar HACIA ATRÁS: una cita
 * de hace 3 meses con un video "1 año después" todavía tiene su envío en el futuro.
 * Para videos ANTES basta con las citas futuras (desde hoy).
 */
function fechaInferiorBackfill(momento: MomentoVideo, offsetValor: number, offsetUnidad: UnidadOffset, ahora: Date): Date {
  if (momento === 'ANTES') return new Date(`${ahora.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const d = new Date(ahora);
  if (offsetUnidad === 'HORAS') d.setTime(d.getTime() - offsetValor * 3_600_000);
  else if (offsetUnidad === 'DIAS') d.setTime(d.getTime() - offsetValor * 86_400_000);
  else if (offsetUnidad === 'MESES') d.setUTCMonth(d.getUTCMonth() - offsetValor);
  else d.setUTCFullYear(d.getUTCFullYear() - offsetValor);
  d.setUTCDate(d.getUTCDate() - 1); // margen de 1 día
  return new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function emailEnviable(p: { email: string | null; emailInvalido: boolean }): boolean {
  return !!p.email && !p.emailInvalido && esEmailEnviable(p.email);
}

/**
 * Crea o ACTUALIZA el log de un par (cita, video). Nunca inserta duplicados (respeta
 * el índice único parcial). Un log ya ENVIADO nunca se toca (R2). Devuelve nada.
 */
async function upsertLog(args: {
  citaId: string;
  servicioVideoId: string;
  pacienteEmail: string;
  scheduledFor: Date;
  ahora: Date;
}): Promise<void> {
  const { citaId, servicioVideoId, pacienteEmail, scheduledFor, ahora } = args;
  const fueraVentana = scheduledFor.getTime() <= ahora.getTime();
  const estado = fueraVentana ? 'CANCELADO' : 'PENDIENTE';
  const motivoCancelacion = fueraVentana ? MOTIVO.FUERA_VENTANA : null;

  const existente = await prisma.videoEnvioLog.findFirst({
    where: { citaId, servicioVideoId, deletedAt: null },
    select: { id: true, estado: true },
  });

  if (!existente) {
    await prisma.videoEnvioLog.create({
      data: { citaId, servicioVideoId, pacienteEmail, scheduledFor, estado, motivoCancelacion },
    });
    return;
  }
  if (existente.estado === 'ENVIADO') return; // el paciente ya lo vio: no reenviar (R2)
  await prisma.videoEnvioLog.update({
    where: { id: existente.id },
    data: { scheduledFor, estado, motivoCancelacion, errorDetalle: null, pacienteEmail },
  });
}

interface VideoProg { id: string; servicioId: string; momento: MomentoVideo; offsetValor: number; offsetUnidad: UnidadOffset }

/**
 * Regla "solo la más reciente" para videos DESPUÉS: el recordatorio de un video se ata a
 * la ÚLTIMA cita del paciente en ese servicio. Anula los PENDIENTES de citas anteriores
 * del mismo paciente+video y deja (o crea) el de la última cita. Los ENVIADO no se tocan.
 * Se llama al crear/reprogramar/cancelar una cita y en el backfill.
 */
async function sincronizarDespuesPaciente(video: VideoProg, pacienteId: string, ahora: Date): Promise<void> {
  const ultima = await prisma.cita.findFirst({
    where: { pacienteId, servicioId: video.servicioId, deletedAt: null, estado: { notIn: ESTADOS_INACTIVOS as never } },
    orderBy: [{ fecha: 'desc' }, { horaInicio: 'desc' }],
    select: { id: true, fecha: true, horaInicio: true, paciente: { select: { email: true, emailInvalido: true } } },
  });

  // Anula los PENDIENTES de ESTE video para ESTE paciente que no sean de la última cita.
  await prisma.videoEnvioLog.updateMany({
    where: {
      servicioVideoId: video.id, estado: 'PENDIENTE', deletedAt: null,
      cita: { pacienteId },
      ...(ultima ? { NOT: { citaId: ultima.id } } : {}),
    },
    data: { estado: 'CANCELADO', motivoCancelacion: MOTIVO.SUPERADO },
  });

  // Programa (o recalcula) el de la última cita, si su envío aún es futuro, tiene correo
  // enviable y NO está en la lista de exclusión de videos.
  if (ultima && emailEnviable(ultima.paciente) && !(await estaSuprimido(ultima.paciente.email))) {
    const scheduledFor = calcularScheduledFor(ultima.fecha, ultima.horaInicio, video.momento, video.offsetValor, video.offsetUnidad);
    if (scheduledFor.getTime() > ahora.getTime()) {
      await upsertLog({ citaId: ultima.id, servicioVideoId: video.id, pacienteEmail: ultima.paciente.email!, scheduledFor, ahora });
    }
  }
}

/**
 * Sincroniza los logs de video de UNA cita con los videos activos de su servicio.
 * Usada al crear y al reprogramar la cita. Los videos ANTES se programan por cita (cada
 * próxima cita lleva su video de preparación); los DESPUÉS se atan a la ÚLTIMA cita del
 * paciente (regla "solo la más reciente"). Idempotente y fire-and-forget.
 */
export async function sincronizarVideosDeCita(citaId: string): Promise<void> {
  try {
    const cita = await prisma.cita.findUnique({
      where: { id: citaId, deletedAt: null },
      select: {
        estado: true, fecha: true, horaInicio: true, servicioId: true, pacienteId: true,
        paciente: { select: { email: true, emailInvalido: true } },
      },
    });
    if (!cita || citaInactiva(cita.estado)) return;
    if (!emailEnviable(cita.paciente)) {
      console.log(`[video] cita ${citaId}: paciente sin correo enviable — no se crean envíos.`);
      return;
    }
    if (await estaSuprimido(cita.paciente.email)) {
      console.log(`[video] cita ${citaId}: correo en lista de exclusión de videos — no se crean envíos.`);
      return;
    }

    const videos = await prisma.servicioVideo.findMany({
      where: { servicioId: cita.servicioId, activo: true, deletedAt: null },
      select: { id: true, servicioId: true, momento: true, offsetValor: true, offsetUnidad: true },
    });
    const ahora = new Date();
    for (const v of videos) {
      if (v.momento === 'DESPUES') {
        await sincronizarDespuesPaciente(v, cita.pacienteId, ahora);
      } else {
        const scheduledFor = calcularScheduledFor(cita.fecha, cita.horaInicio, v.momento, v.offsetValor, v.offsetUnidad);
        await upsertLog({ citaId, servicioVideoId: v.id, pacienteEmail: cita.paciente.email!, scheduledFor, ahora });
      }
    }
  } catch (err) {
    console.warn(`[video] No se pudo sincronizar (cita ${citaId}):`, err instanceof Error ? err.message : err);
  }
}

/**
 * Al cancelar una cita: sus envíos PENDIENTES pasan a CANCELADO. Además, para los videos
 * DESPUÉS, si esta era la última cita del paciente, reengancha el recordatorio a la cita
 * ANTERIOR del paciente (regla "solo la más reciente" al retroceder).
 */
export async function cancelarVideosDeCita(citaId: string): Promise<void> {
  try {
    await prisma.videoEnvioLog.updateMany({
      where: { citaId, estado: 'PENDIENTE', deletedAt: null },
      data: { estado: 'CANCELADO', motivoCancelacion: MOTIVO.CITA_CANCELADA },
    });
    const cita = await prisma.cita.findUnique({ where: { id: citaId }, select: { servicioId: true, pacienteId: true } });
    if (!cita) return;
    const videos = await prisma.servicioVideo.findMany({
      where: { servicioId: cita.servicioId, activo: true, deletedAt: null, momento: 'DESPUES' },
      select: { id: true, servicioId: true, momento: true, offsetValor: true, offsetUnidad: true },
    });
    const ahora = new Date();
    for (const v of videos) await sincronizarDespuesPaciente(v, cita.pacienteId, ahora);
  } catch (err) {
    console.warn(`[video] No se pudo cancelar (cita ${citaId}):`, err instanceof Error ? err.message : err);
  }
}

/**
 * R3 — Backfill: al crear/activar un video, genera logs para las citas FUTURAS del
 * servicio (estado válido + correo enviable). Fire-and-forget (no bloquea el POST).
 */
export async function backfillVideoNuevo(servicioVideoId: string): Promise<void> {
  try {
    const video = await prisma.servicioVideo.findFirst({
      where: { id: servicioVideoId, activo: true, deletedAt: null },
      select: { id: true, servicioId: true, momento: true, offsetValor: true, offsetUnidad: true },
    });
    if (!video) return;

    const ahora = new Date();
    // Rango de citas: para DESPUÉS con offset largo (meses/años) miramos hacia atrás,
    // porque una cita ya pasada puede tener su aniversario aún en el futuro.
    const desde = fechaInferiorBackfill(video.momento, video.offsetValor, video.offsetUnidad, ahora);
    const CAP = 20_000; // tope de seguridad para offsets muy largos

    if (video.momento === 'DESPUES') {
      // Regla "solo la más reciente": un recordatorio por PACIENTE (su última cita del
      // servicio), no uno por cada cita histórica.
      const pacientes = await prisma.cita.findMany({
        where: { servicioId: video.servicioId, deletedAt: null, estado: { notIn: ESTADOS_INACTIVOS as never }, fecha: { gte: desde } },
        select: { pacienteId: true },
        distinct: ['pacienteId'],
        take: CAP,
      });
      if (pacientes.length === CAP) {
        console.warn(`[video] Backfill (video ${servicioVideoId}) alcanzó el tope de ${CAP} pacientes; algunos podrían no cubrirse.`);
      }
      for (const p of pacientes) await sincronizarDespuesPaciente(video, p.pacienteId, ahora);
      if (pacientes.length) console.log(`[video] Backfill (después) video ${servicioVideoId}: ${pacientes.length} pacientes procesados.`);
      return;
    }

    // ANTES: un video por cada cita FUTURA.
    const citas = await prisma.cita.findMany({
      where: {
        servicioId: video.servicioId,
        deletedAt: null,
        estado: { notIn: ESTADOS_INACTIVOS as never },
        fecha: { gte: desde },
      },
      select: {
        id: true, fecha: true, horaInicio: true,
        paciente: { select: { email: true, emailInvalido: true } },
      },
      take: CAP,
    });
    if (citas.length === CAP) {
      console.warn(`[video] Backfill (video ${servicioVideoId}) alcanzó el tope de ${CAP} citas; algunas citas antiguas podrían no cubrirse.`);
    }

    const suprimidos = await setCorreosSuprimidos();
    let creados = 0;
    for (const c of citas) {
      if (!emailEnviable(c.paciente)) continue;
      if (suprimidos.has(normEmail(c.paciente.email!))) continue; // en lista de exclusión
      const scheduledFor = calcularScheduledFor(c.fecha, c.horaInicio, video.momento, video.offsetValor, video.offsetUnidad);
      if (scheduledFor.getTime() <= ahora.getTime()) continue; // el envío ya pasó → no crear
      await upsertLog({ citaId: c.id, servicioVideoId: video.id, pacienteEmail: c.paciente.email!, scheduledFor, ahora });
      creados++;
    }
    if (creados) console.log(`[video] Backfill video ${servicioVideoId}: ${creados} envíos programados.`);
  } catch (err) {
    console.warn(`[video] Backfill falló (video ${servicioVideoId}):`, err instanceof Error ? err.message : err);
  }
}

/**
 * R4 — Al editar momento/offset de un video: recalcula scheduledFor de sus logs NO
 * enviados (PENDIENTE o CANCELADO "fuera_de_ventana"), reactivando o volviendo a
 * cancelar según la nueva hora. Los ENVIADO no se tocan.
 */
export async function recalcularOffsetVideo(servicioVideoId: string): Promise<void> {
  try {
    const video = await prisma.servicioVideo.findFirst({
      where: { id: servicioVideoId, deletedAt: null },
      select: { id: true, activo: true, momento: true, offsetValor: true, offsetUnidad: true },
    });
    if (!video) return;

    const logs = await prisma.videoEnvioLog.findMany({
      where: {
        servicioVideoId: video.id,
        deletedAt: null,
        OR: [
          { estado: 'PENDIENTE' },
          { estado: 'CANCELADO', motivoCancelacion: MOTIVO.FUERA_VENTANA },
        ],
      },
      select: { id: true, cita: { select: { estado: true, deletedAt: true, fecha: true, horaInicio: true } } },
    });

    const ahora = new Date();
    for (const log of logs) {
      const c = log.cita;
      // Si el video quedó pausado, o la cita ya no es válida, cancela y sigue.
      if (!video.activo) {
        await prisma.videoEnvioLog.update({ where: { id: log.id }, data: { estado: 'CANCELADO', motivoCancelacion: MOTIVO.VIDEO_PAUSADO } });
        continue;
      }
      if (!c || c.deletedAt || citaInactiva(c.estado)) {
        await prisma.videoEnvioLog.update({ where: { id: log.id }, data: { estado: 'CANCELADO', motivoCancelacion: MOTIVO.CITA_CANCELADA } });
        continue;
      }
      const scheduledFor = calcularScheduledFor(c.fecha, c.horaInicio, video.momento, video.offsetValor, video.offsetUnidad);
      const fueraVentana = scheduledFor.getTime() <= ahora.getTime();
      await prisma.videoEnvioLog.update({
        where: { id: log.id },
        data: {
          scheduledFor,
          estado: fueraVentana ? 'CANCELADO' : 'PENDIENTE',
          motivoCancelacion: fueraVentana ? MOTIVO.FUERA_VENTANA : null,
          errorDetalle: null,
        },
      });
    }
  } catch (err) {
    console.warn(`[video] Recalcular offset falló (video ${servicioVideoId}):`, err instanceof Error ? err.message : err);
  }
}

/**
 * Al editar la programación (momento/offset) de un video: recalcula los logs existentes
 * (maneja el caso en que el rango se ACORTA) y re-ejecuta el backfill (agrega las citas
 * que entren al nuevo rango y, para DESPUÉS, aplica la regla "solo la más reciente").
 */
export async function reprogramarVideo(servicioVideoId: string): Promise<void> {
  await recalcularOffsetVideo(servicioVideoId);
  await backfillVideoNuevo(servicioVideoId);
}

/** Al pausar/eliminar un video: sus envíos PENDIENTES pasan a CANCELADO. */
export async function cancelarEnviosDeVideo(servicioVideoId: string, motivo: string): Promise<number> {
  const r = await prisma.videoEnvioLog.updateMany({
    where: { servicioVideoId, estado: 'PENDIENTE', deletedAt: null },
    data: { estado: 'CANCELADO', motivoCancelacion: motivo },
  });
  return r.count;
}

/** Cuántos envíos PENDIENTES tiene un video (para el diálogo de confirmación de borrado). */
export function contarPendientesDeVideo(servicioVideoId: string): Promise<number> {
  return prisma.videoEnvioLog.count({ where: { servicioVideoId, estado: 'PENDIENTE', deletedAt: null } });
}

// ─── Render del correo (compartido por envío real, preview y prueba) ──────────
interface DatosVideoParaCorreo {
  asunto: string;
  tituloVideo: string;
  cuerpoTexto: string;
  youtubeVideoId: string;
  youtubeUrl: string;
}

/**
 * Construye { subject, html } del correo de un video, con variables sustituidas.
 * ÚNICO motor: lo usan el envío real, el preview del modal y el correo de prueba
 * (nunca dos plantillas paralelas → la vista previa coincide con lo recibido).
 */
export function construirCorreoVideo(
  v: DatosVideoParaCorreo,
  destinatario: { nombrePaciente: string; primerNombre: string; servicio: string; fecha: string },
): { subject: string; html: string } {
  const vars = { paciente: destinatario.primerNombre, servicio: destinatario.servicio, fecha: destinatario.fecha };
  const short = esShort(v.youtubeUrl);
  const html = renderPlantillaVideo({
    nombrePaciente: destinatario.nombrePaciente,
    tituloVideo: aplicarVariablesVideo(v.tituloVideo, vars),
    cuerpoTexto: aplicarVariablesVideo(v.cuerpoTexto, vars),
    thumbnailUrl: thumbnailVertical(v.youtubeVideoId),
    urlVideo: urlPublicaYoutube(v.youtubeVideoId, short),
  });
  return { subject: aplicarVariablesVideo(v.asunto, vars), html };
}

/** Datos de muestra para preview/prueba (sin una cita real). */
export function muestraDestinatario(nombrePaciente = 'María García'): {
  nombrePaciente: string; primerNombre: string; servicio: string; fecha: string;
} {
  const primerNombre = nombrePaciente.split(' ')[0] || nombrePaciente;
  return { nombrePaciente, primerNombre, servicio: 'Quiropodia', fecha: 'lunes 13 de julio 2026' };
}

// ─── Barrido de envío (lo corre el job repetible cada 5 min) ──────────────────
type LogConRelaciones = {
  id: string;
  scheduledFor: Date;
  intentos: number;
  servicioVideo: Pick<ServicioVideo, 'id' | 'activo' | 'deletedAt' | 'asunto' | 'tituloVideo' | 'cuerpoTexto' | 'youtubeVideoId' | 'youtubeUrl'> | null;
  cita: {
    id: string; estado: string; deletedAt: Date | null; fecha: Date; horaInicio: string; sedeId: string;
    servicio: { nombre: string };
    paciente: { nombres: string; apellidoPaterno: string; email: string | null; emailInvalido: boolean };
  } | null;
};

/** Envía el correo de un log (ya validado). Devuelve el id de Resend. */
async function enviarLog(log: LogConRelaciones): Promise<string | null> {
  const v = log.servicioVideo!;
  const c = log.cita!;
  const { subject, html } = construirCorreoVideo(
    { asunto: v.asunto, tituloVideo: v.tituloVideo, cuerpoTexto: v.cuerpoTexto, youtubeVideoId: v.youtubeVideoId, youtubeUrl: v.youtubeUrl },
    {
      nombrePaciente: `${c.paciente.nombres} ${c.paciente.apellidoPaterno}`,
      primerNombre: c.paciente.nombres,
      servicio: c.servicio.nombre,
      fecha: capitalizar(formatFechaLargaEs(c.fecha)),
    },
  );
  const res = await enviarEmail({ to: c.paciente.email!, subject, html });
  return res?.id ?? null;
}

/**
 * Barrido de envíos vencidos. Busca PENDIENTES con scheduledFor <= ahora, revalida cada
 * uno (R1) y envía. Los que quedaron >6 h atrás → ERROR "ventana expirada". Reintentos
 * hasta MAX_INTENTOS (el propio barrido de 5 min reintenta los que quedan PENDIENTE).
 */
export async function procesarBarridoVideos(): Promise<{ enviados: number; cancelados: number; errores: number; expirados: number }> {
  const stats = { enviados: 0, cancelados: 0, errores: 0, expirados: 0 };
  if (!resendConfigurado()) {
    console.warn('[video] RESEND_API_KEY ausente — barrido omitido; los envíos quedan PENDIENTE.');
    return stats;
  }

  const ahora = new Date();
  const due = (await prisma.videoEnvioLog.findMany({
    where: { estado: 'PENDIENTE', deletedAt: null, scheduledFor: { lte: ahora } },
    orderBy: { scheduledFor: 'asc' },
    take: LOTE_BARRIDO,
    select: {
      id: true, scheduledFor: true, intentos: true,
      servicioVideo: { select: { id: true, activo: true, deletedAt: true, asunto: true, tituloVideo: true, cuerpoTexto: true, youtubeVideoId: true, youtubeUrl: true } },
      cita: {
        select: {
          id: true, estado: true, deletedAt: true, fecha: true, horaInicio: true, sedeId: true,
          servicio: { select: { nombre: true } },
          paciente: { select: { nombres: true, apellidoPaterno: true, email: true, emailInvalido: true } },
        },
      },
    },
  })) as LogConRelaciones[];

  const limiteViejo = ahora.getTime() - VENTANA_TOLERANCIA_MS;
  const suprimidos = await setCorreosSuprimidos(); // lista de exclusión de videos (1 consulta)

  for (const log of due) {
    // Ventana expirada: no enviar correos absurdamente tarde tras una caída del servidor.
    if (log.scheduledFor.getTime() < limiteViejo) {
      await prisma.videoEnvioLog.update({ where: { id: log.id }, data: { estado: 'ERROR', errorDetalle: 'ventana expirada' } });
      stats.expirados++;
      continue;
    }

    // R1 — revalidación al vuelo.
    const c = log.cita; const v = log.servicioVideo;
    if (!c || c.deletedAt || citaInactiva(c.estado)) {
      await prisma.videoEnvioLog.update({ where: { id: log.id }, data: { estado: 'CANCELADO', motivoCancelacion: MOTIVO.CITA_CANCELADA } });
      stats.cancelados++; continue;
    }
    if (!v || v.deletedAt || !v.activo) {
      await prisma.videoEnvioLog.update({ where: { id: log.id }, data: { estado: 'CANCELADO', motivoCancelacion: v?.deletedAt ? MOTIVO.VIDEO_ELIMINADO : MOTIVO.VIDEO_PAUSADO } });
      stats.cancelados++; continue;
    }
    if (!emailEnviable(c.paciente)) {
      await prisma.videoEnvioLog.update({ where: { id: log.id }, data: { estado: 'CANCELADO', motivoCancelacion: MOTIVO.SIN_EMAIL } });
      stats.cancelados++; continue;
    }
    if (c.paciente.email && suprimidos.has(normEmail(c.paciente.email))) {
      // El correo se agregó a la lista de exclusión después de programarse → no enviar.
      await prisma.videoEnvioLog.update({ where: { id: log.id }, data: { estado: 'CANCELADO', motivoCancelacion: MOTIVO.OPT_OUT } });
      stats.cancelados++; continue;
    }

    try {
      const resendEmailId = await enviarLog(log);
      await prisma.videoEnvioLog.update({
        where: { id: log.id },
        data: { estado: 'ENVIADO', sentAt: new Date(), resendEmailId, intentos: { increment: 1 }, errorDetalle: null },
      });
      await registrarAudit({
        citaId: c.id, accion: 'video_enviado', entidad: 'video_envio_log', entidadId: log.id, sedeId: c.sedeId,
        despues: { servicioVideoId: v.id, destinatario: c.paciente.email, resendEmailId },
      });
      stats.enviados++;
    } catch (err) {
      const intentos = log.intentos + 1;
      const agotado = intentos >= MAX_INTENTOS;
      await prisma.videoEnvioLog.update({
        where: { id: log.id },
        data: { intentos, errorDetalle: err instanceof Error ? err.message : String(err), estado: agotado ? 'ERROR' : 'PENDIENTE' },
      });
      if (agotado) stats.errores++;
    }
  }

  return stats;
}
