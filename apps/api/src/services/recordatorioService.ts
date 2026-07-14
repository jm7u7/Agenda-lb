import { prisma } from '../db';
import { enviarCorreoReserva, enviarCorreoRecordatorio, resendConfigurado } from './emailService';
import { crearTokenAccion } from './tokenAccionCita';
import { programarJobRecordatorio, cancelarJobRecordatorio, programarJobReserva } from '../queue/recordatorioQueue';
import { registrarAudit } from './audit';
import { asegurarCupoEnvio, QuotaExcedidaError, proximaVentanaEnvio } from './mailQuota';
import { citaInicioUtc } from '../utils/fechaLima';

const ESTADOS_INACTIVOS = ['cancelada', 'no_show', 'reprogramada'];
const MAX_INTENTOS = 3;

/**
 * Regla unificada de tiempo de envío del recordatorio (Correo 2):
 *  - Normal: cita − 2h.  - Reserva tardía (<2h): cita − 1h.  - <1h: ya.
 */
export function calcularProgramadoPara(fecha: Date, horaInicio: string, ahora: Date = new Date()): Date {
  const inicio = citaInicioUtc(fecha, horaInicio);
  const minFalta = (inicio.getTime() - ahora.getTime()) / 60000;
  if (minFalta < 60) return new Date(ahora.getTime());
  if (minFalta < 120) return new Date(inicio.getTime() - 60 * 60_000);
  return new Date(inicio.getTime() - 120 * 60_000);
}

function apiBase(): string {
  return (process.env.API_BASE_URL || 'http://localhost:3002').replace(/\/$/, '');
}

/**
 * Al crear una cita: registra y envía el Correo 1 (reserva) y programa el
 * Correo 2 (recordatorio). Idempotente: una cita = un recordatorio de cada tipo.
 * Fire-and-forget: nunca lanza ni bloquea la creación de la cita.
 */
export async function programarRecordatoriosDeCita(citaId: string): Promise<void> {
  try {
    const cita = await prisma.cita.findUnique({
      where: { id: citaId, deletedAt: null },
      select: { id: true, estado: true, fecha: true, horaInicio: true, paciente: { select: { email: true } } },
    });
    if (!cita || ESTADOS_INACTIVOS.includes(cita.estado) || !cita.paciente.email) return;

    // ── Correo 1: reserva ──
    const reservaExistente = await prisma.recordatorioCita.findFirst({
      where: { citaId, tipo: 'RESERVA', deletedAt: null, estado: { not: 'CANCELADO' } },
    });
    if (!reservaExistente) {
      await prisma.recordatorioCita.create({ data: { citaId, tipo: 'RESERVA', programadoPara: new Date(), estado: 'PROGRAMADO' } });
      await procesarEnvioReserva(citaId); // envía ya (o difiere por cuota)
    }

    // ── Correo 2: recordatorio (programado para 2 h antes de la cita) ──
    const ahora = new Date();
    const programadoPara = calcularProgramadoPara(cita.fecha, cita.horaInicio, ahora);
    // Si ese momento ya pasó (cita reservada con muy poca anticipación o ya pasada), NO
    // enviar el Correo 2: llegaría PEGADO al Correo 1 de reserva. El recordatorio solo
    // tiene sentido si cae en un instante FUTURO, separado de la confirmación de reserva.
    if (programadoPara.getTime() <= ahora.getTime() + 60_000) return;

    const recExistente = await prisma.recordatorioCita.findFirst({
      where: { citaId, tipo: 'RECORDATORIO', deletedAt: null, estado: { not: 'CANCELADO' } },
    });
    if (recExistente?.estado === 'ENVIADO') return;

    let recId = recExistente?.id;
    if (recExistente) {
      await prisma.recordatorioCita.update({ where: { id: recExistente.id }, data: { programadoPara } });
    } else {
      const rec = await prisma.recordatorioCita.create({ data: { citaId, tipo: 'RECORDATORIO', programadoPara, estado: 'PROGRAMADO' } });
      recId = rec.id;
    }
    const jobId = await programarJobRecordatorio(citaId, programadoPara);
    if (recId && jobId) await prisma.recordatorioCita.update({ where: { id: recId }, data: { jobId } });
  } catch (err) {
    console.warn(`[recordatorio] No se pudo programar (cita ${citaId}):`, err instanceof Error ? err.message : err);
  }
}

/** Envía el Correo 1 de reserva. Difiere por cuota; reintenta ante error transitorio. */
export async function procesarEnvioReserva(citaId: string): Promise<'enviado' | 'diferido' | 'omitido' | 'fallido'> {
  const rec = await prisma.recordatorioCita.findFirst({
    where: { citaId, tipo: 'RESERVA', deletedAt: null, estado: { not: 'CANCELADO' } },
  });
  if (!rec || rec.estado === 'ENVIADO') return 'omitido';

  const cita = await prisma.cita.findUnique({
    where: { id: citaId, deletedAt: null },
    select: { estado: true, sedeId: true, paciente: { select: { email: true } } },
  });
  if (!cita || ESTADOS_INACTIVOS.includes(cita.estado) || !cita.paciente.email) {
    await prisma.recordatorioCita.update({ where: { id: rec.id }, data: { estado: 'CANCELADO' } });
    return 'omitido';
  }
  if (!resendConfigurado()) {
    console.warn(`[recordatorio] RESEND_API_KEY ausente — envío omitido (cita ${citaId}); el recordatorio de reserva queda PROGRAMADO.`);
    return 'omitido';
  }

  // Cuota diaria: si se alcanzó, diferir al día siguiente.
  try { await asegurarCupoEnvio(); }
  catch (e) {
    if (e instanceof QuotaExcedidaError) {
      const cuando = proximaVentanaEnvio();
      await prisma.recordatorioCita.update({ where: { id: rec.id }, data: { estado: 'PROGRAMADO', programadoPara: cuando } });
      await programarJobReserva(citaId, cuando);
      return 'diferido';
    }
    throw e;
  }

  try {
    const { to, id } = await enviarCorreoReserva(citaId);
    await prisma.recordatorioCita.update({ where: { id: rec.id }, data: { estado: 'ENVIADO', resendEmailId: id, enviadoAt: new Date(), intentos: { increment: 1 } } });
    await registrarAudit({ citaId, accion: 'recordatorio_reserva_enviado', entidad: 'cita', entidadId: citaId, sedeId: cita.sedeId, despues: { tipo: 'reserva', destinatario: to, resendEmailId: id } });
    return 'enviado';
  } catch (err) {
    const intentos = rec.intentos + 1;
    const fin = intentos >= MAX_INTENTOS;
    await prisma.recordatorioCita.update({ where: { id: rec.id }, data: { intentos, errorMensaje: err instanceof Error ? err.message : String(err), estado: fin ? 'FALLIDO' : 'PROGRAMADO' } });
    if (!fin) await programarJobReserva(citaId, new Date(Date.now() + 2 * 60_000)); // reintento 2 min
    return 'fallido';
  }
}

/**
 * Procesa el envío del recordatorio (Correo 2). Lo llama el worker de BullMQ.
 * Difiere por cuota; lanza ante error transitorio para que BullMQ reintente.
 *
 * `tipo` decide qué cupo consume: 'auto' (worker en masa, deja reserva libre) o
 * 'manual' (reenvío disparado por recepción, puede usar la reserva → no queda
 * bloqueado por los recordatorios automáticos del día). Ver `mailQuota`.
 */
export async function procesarEnvioRecordatorio(citaId: string, tipo: 'auto' | 'manual' = 'auto'): Promise<'enviado' | 'cancelado' | 'omitido' | 'diferido'> {
  const rec = await prisma.recordatorioCita.findFirst({
    where: { citaId, tipo: 'RECORDATORIO', deletedAt: null, estado: { not: 'CANCELADO' } },
  });
  if (!rec) return 'omitido';
  if (rec.estado === 'ENVIADO') return 'omitido';

  const cita = await prisma.cita.findUnique({
    where: { id: citaId, deletedAt: null },
    select: { id: true, estado: true, fecha: true, horaInicio: true, sedeId: true },
  });
  if (!cita || ESTADOS_INACTIVOS.includes(cita.estado)) {
    await prisma.recordatorioCita.update({ where: { id: rec.id }, data: { estado: 'CANCELADO' } });
    return 'cancelado';
  }
  if (!resendConfigurado()) {
    console.warn(`[recordatorio] RESEND_API_KEY ausente — envío omitido (cita ${citaId}); el recordatorio queda PROGRAMADO.`);
    return 'omitido';
  }

  // Cuota diaria: diferir antes de generar tokens (evita tokens huérfanos).
  try { await asegurarCupoEnvio(tipo); }
  catch (e) {
    if (e instanceof QuotaExcedidaError) {
      const cuando = proximaVentanaEnvio();
      await prisma.recordatorioCita.update({ where: { id: rec.id }, data: { estado: 'PROGRAMADO', programadoPara: cuando } });
      await programarJobRecordatorio(citaId, cuando);
      return 'diferido';
    }
    throw e;
  }

  // Tokens de un solo uso; expiran tras la hora de la cita (+2h de gracia).
  const inicio = citaInicioUtc(cita.fecha, cita.horaInicio);
  const expiraEn = new Date(inicio.getTime() + 2 * 60 * 60_000);
  const tokenConfirmar = await crearTokenAccion(citaId, 'confirmar', expiraEn);
  const tokenReprogramar = await crearTokenAccion(citaId, 'reprogramar', expiraEn);

  try {
    const { to, id } = await enviarCorreoRecordatorio({
      citaId,
      urlConfirmar: `${apiBase()}/api/v1/citas/confirmar/${tokenConfirmar}`,
      urlReprogramar: `${apiBase()}/api/v1/citas/reprogramar/${tokenReprogramar}`,
    });
    await prisma.recordatorioCita.update({ where: { id: rec.id }, data: { estado: 'ENVIADO', resendEmailId: id, enviadoAt: new Date(), intentos: { increment: 1 } } });
    await registrarAudit({ citaId, accion: 'recordatorio_enviado', entidad: 'cita', entidadId: citaId, sedeId: cita.sedeId, despues: { tipo: 'recordatorio', destinatario: to, resendEmailId: id } });
    return 'enviado';
  } catch (err) {
    const intentos = rec.intentos + 1;
    await prisma.recordatorioCita.update({
      where: { id: rec.id },
      data: { intentos, errorMensaje: err instanceof Error ? err.message : String(err), estado: intentos >= MAX_INTENTOS ? 'FALLIDO' : rec.estado },
    });
    throw err; // que BullMQ reintente con backoff
  }
}

/** Fuerza el reenvío inmediato del recordatorio (botón manual de recepción). */
export async function forzarEnvioRecordatorioAhora(citaId: string): Promise<{ to: string | null; estado: string }> {
  const cita = await prisma.cita.findUnique({ where: { id: citaId, deletedAt: null }, select: { fecha: true, horaInicio: true, paciente: { select: { email: true } } } });
  if (!cita) throw new Error('Cita no encontrada');

  let rec = await prisma.recordatorioCita.findFirst({ where: { citaId, tipo: 'RECORDATORIO', deletedAt: null }, orderBy: { creadoEn: 'desc' } });
  if (!rec) {
    rec = await prisma.recordatorioCita.create({ data: { citaId, tipo: 'RECORDATORIO', programadoPara: calcularProgramadoPara(cita.fecha, cita.horaInicio), estado: 'PROGRAMADO' } });
  } else {
    await prisma.recordatorioCita.update({ where: { id: rec.id }, data: { estado: 'PROGRAMADO', errorMensaje: null } });
  }
  // Reenvío manual de recepción: usa el cupo 'manual' (con reserva propia), para
  // que no lo frene la cuota que ya consumieron los recordatorios automáticos.
  const estado = await procesarEnvioRecordatorio(citaId, 'manual');
  return { to: cita.paciente.email ?? null, estado };
}

/** Cancela el recordatorio de una cita (cancelación / reprogramación a otra cita). */
export async function cancelarRecordatoriosDeCita(citaId: string): Promise<void> {
  try {
    await cancelarJobRecordatorio(citaId);
    await prisma.recordatorioCita.updateMany({
      where: { citaId, tipo: 'RECORDATORIO', estado: 'PROGRAMADO', deletedAt: null },
      data: { estado: 'CANCELADO' },
    });
  } catch (err) {
    console.warn(`[recordatorio] No se pudo cancelar (cita ${citaId}):`, err instanceof Error ? err.message : err);
  }
}

/** Reagenda el recordatorio cuando la cita se mueve a otra fecha/hora. */
export async function reprogramarRecordatorioDeCita(citaId: string): Promise<void> {
  try {
    const cita = await prisma.cita.findUnique({ where: { id: citaId, deletedAt: null }, select: { estado: true, fecha: true, horaInicio: true } });
    if (!cita || ESTADOS_INACTIVOS.includes(cita.estado)) return;

    const rec = await prisma.recordatorioCita.findFirst({ where: { citaId, tipo: 'RECORDATORIO', deletedAt: null, estado: { not: 'CANCELADO' } } });
    if (!rec) { await programarRecordatoriosDeCita(citaId); return; }
    if (rec.estado === 'ENVIADO') return;

    const programadoPara = calcularProgramadoPara(cita.fecha, cita.horaInicio);
    const jobId = await programarJobRecordatorio(citaId, programadoPara);
    await prisma.recordatorioCita.update({ where: { id: rec.id }, data: { programadoPara, jobId, estado: 'PROGRAMADO' } });
  } catch (err) {
    console.warn(`[recordatorio] No se pudo reprogramar (cita ${citaId}):`, err instanceof Error ? err.message : err);
  }
}
