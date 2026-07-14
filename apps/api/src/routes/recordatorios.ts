import { Router } from 'express';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { registrarAudit } from '../services/audit';
import { programarJobRecordatorio } from '../queue/recordatorioQueue';
import { enviosHoy, LIMITE_DIARIO, RESERVA_MANUAL, LIMITE_AUTOMATICO } from '../services/mailQuota';

const router = Router();

// Filtro común de citas (por fecha/sede/profesional) para los recordatorios.
function filtroCita(q: Record<string, string | undefined>) {
  const cita: Record<string, unknown> = { deletedAt: null };
  if (q.sedeId) cita.sedeId = q.sedeId;
  if (q.profesionalId) cita.profesionalId = q.profesionalId;
  if (q.fecha) {
    cita.fecha = new Date(q.fecha + 'T12:00:00');
  } else if (q.fechaDesde && q.fechaHasta) {
    cita.fecha = { gte: new Date(q.fechaDesde + 'T00:00:00'), lte: new Date(q.fechaHasta + 'T23:59:59') };
  }
  return cita;
}

// ─── GET /recordatorios/dia ─── vista por día: citas + estado del recordatorio ─
router.get('/dia', requireAuth, async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const recs = await prisma.recordatorioCita.findMany({
    where: {
      tipo: 'RECORDATORIO',
      deletedAt: null,
      ...(q.estado ? { estado: q.estado as never } : {}),
      cita: filtroCita(q),
    },
    include: {
      cita: {
        select: {
          id: true, fecha: true, horaInicio: true, estado: true, estadoConfirmacion: true,
          paciente: { select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true, email: true, telefono: true } },
          profesional: { select: { nombres: true, apellidos: true } },
          sede: { select: { nombre: true } },
          servicio: { select: { nombre: true } },
        },
      },
    },
    orderBy: { cita: { horaInicio: 'asc' } },
  });

  res.json(recs.map((r) => ({
    recordatorioId: r.id,
    citaId: r.citaId,
    estadoRecordatorio: r.estado,
    programadoPara: r.programadoPara,
    intentos: r.intentos,
    gmailMessageId: r.gmailMessageId,
    clickConfirmarAt: r.clickConfirmarAt,
    clickReprogramarAt: r.clickReprogramarAt,
    confirmadoAt: r.confirmadoAt,
    errorMensaje: r.errorMensaje,
    fecha: r.cita.fecha,
    hora: r.cita.horaInicio,
    estadoCita: r.cita.estado,
    estadoConfirmacion: r.cita.estadoConfirmacion,
    paciente: `${r.cita.paciente.nombres} ${r.cita.paciente.apellidoPaterno} ${r.cita.paciente.apellidoMaterno}`,
    email: r.cita.paciente.email,
    telefono: r.cita.paciente.telefono,
    profesional: r.cita.profesional ? `${r.cita.profesional.nombres} ${r.cita.profesional.apellidos}` : null,
    sede: r.cita.sede.nombre,
    servicio: r.cita.servicio.nombre,
  })));
});

// ─── GET /recordatorios/metricas ─── agregados (sin tracking de apertura) ──────
router.get('/metricas', requireAuth, async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const recs = await prisma.recordatorioCita.findMany({
    where: { tipo: 'RECORDATORIO', deletedAt: null, cita: filtroCita(q) },
    include: { cita: { select: { fecha: true, sedeId: true, sede: { select: { nombre: true } } } } },
  });

  const total = recs.length;
  const enviados = recs.filter((r) => r.estado === 'ENVIADO');
  const programados = recs.filter((r) => r.estado === 'PROGRAMADO').length;
  const fallidos = recs.filter((r) => r.estado === 'FALLIDO').length;
  const cancelados = recs.filter((r) => r.estado === 'CANCELADO').length;
  const nEnv = enviados.length;
  const conClic = enviados.filter((r) => r.clickConfirmarAt || r.clickReprogramarAt).length;
  const confirmados = enviados.filter((r) => r.confirmadoAt).length;
  const pidioReprogramar = enviados.filter((r) => r.clickReprogramarAt).length;
  const sinRespuesta = nEnv - conClic;

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

  // Tiempo promedio (min) entre el envío programado y la confirmación.
  const tiempos = enviados
    .filter((r) => r.confirmadoAt)
    .map((r) => (r.confirmadoAt!.getTime() - r.programadoPara.getTime()) / 60000)
    .filter((m) => m >= 0);
  const tiempoPromedioConfirmacionMin = tiempos.length ? Math.round(tiempos.reduce((a, b) => a + b, 0) / tiempos.length) : null;

  // Por sede: tasa de confirmación.
  const porSedeMap = new Map<string, { sede: string; enviados: number; confirmados: number }>();
  for (const r of enviados) {
    const k = r.cita.sedeId;
    const e = porSedeMap.get(k) ?? { sede: r.cita.sede.nombre, enviados: 0, confirmados: 0 };
    e.enviados++; if (r.confirmadoAt) e.confirmados++;
    porSedeMap.set(k, e);
  }
  const porSede = [...porSedeMap.values()].map((s) => ({ ...s, tasaConfirmacion: pct(s.confirmados, s.enviados) }));

  // Evolución por día (de cita).
  const porDiaMap = new Map<string, { fecha: string; enviados: number; confirmados: number }>();
  for (const r of enviados) {
    const k = r.cita.fecha.toISOString().slice(0, 10);
    const e = porDiaMap.get(k) ?? { fecha: k, enviados: 0, confirmados: 0 };
    e.enviados++; if (r.confirmadoAt) e.confirmados++;
    porDiaMap.set(k, e);
  }
  const porDia = [...porDiaMap.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));

  res.json({
    total, enviados: nEnv, programados, fallidos, cancelados,
    confirmados, pidioReprogramar, conClic, sinRespuesta,
    cuotaUsadaHoy: await enviosHoy(),
    cuotaLimiteDiario: LIMITE_DIARIO,
    // Colchón reservado para reenvíos manuales de recepción (los automáticos se
    // detienen en `cuotaLimiteAutomatico`, dejando esta reserva libre).
    cuotaReservaManual: RESERVA_MANUAL,
    cuotaLimiteAutomatico: LIMITE_AUTOMATICO,
    tasaEnvioExitoso: pct(nEnv, total),
    tasaRespuesta: pct(conClic, nEnv),
    tasaConfirmacionEfectiva: pct(confirmados, nEnv),
    pctConfirmados: pct(confirmados, nEnv),
    pctPidioReprogramar: pct(pidioReprogramar, nEnv),
    tiempoPromedioConfirmacionMin,
    porSede,
    porDia,
  });
});

// ─── GET /recordatorios/cita/:citaId ─── detalle/log de una cita ───────────────
router.get('/cita/:citaId', requireAuth, async (req, res) => {
  const recs = await prisma.recordatorioCita.findMany({
    where: { citaId: req.params.citaId, deletedAt: null },
    orderBy: { creadoEn: 'asc' },
  });
  res.json(recs);
});

// ─── POST /recordatorios/:citaId/reenviar ─── forzar reenvío (admin) ───────────
router.post('/:citaId/reenviar', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const rec = await prisma.recordatorioCita.findFirst({
    where: { citaId: req.params.citaId, tipo: 'RECORDATORIO', deletedAt: null },
    orderBy: { creadoEn: 'desc' },
  });
  if (!rec) throw new AppError('Esta cita no tiene recordatorio programado', 404);

  const ahora = new Date();
  await prisma.recordatorioCita.update({
    where: { id: rec.id },
    data: { estado: 'PROGRAMADO', programadoPara: ahora, errorMensaje: null },
  });
  // Reenvío manual del admin: usa el cupo 'manual' (reserva propia) para que no
  // lo frene la cuota consumida por los recordatorios automáticos del día.
  await programarJobRecordatorio(req.params.citaId, ahora, 'manual');
  await registrarAudit({
    citaId: req.params.citaId, usuarioId: req.user?.userId, accion: 'recordatorio_reenvio_manual',
    entidad: 'cita', entidadId: req.params.citaId, ip: req.ip,
  });

  res.json({ ok: true, recordatorioId: rec.id, programadoPara: ahora });
});

export default router;
