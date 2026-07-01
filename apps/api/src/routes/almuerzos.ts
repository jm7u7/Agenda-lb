import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { crearAlmuerzo } from '../services/almuerzoService';

const router = Router();

const NOMBRE_PAZ_SOLDAN = 'Paz Soldán';

// ─── GET /almuerzos?sedeId=X[&fecha=YYYY-MM-DD] ──────────────────────────────
// Devuelve bloqueos de tipo ALMUERZO vigentes en la sede.
// Si se pasa fecha, filtra que esa fecha caiga dentro de fechaInicio..fechaFin.
router.get('/', requireAuth, async (req, res) => {
  const { sedeId, fecha } = req.query as { sedeId?: string; fecha?: string };
  if (!sedeId) throw new AppError('sedeId requerido', 400);

  const where: Record<string, unknown> = {
    sedeId,
    tipo: 'ALMUERZO',
    esRecurrente: true,
    deletedAt: null,
  };

  if (fecha) {
    const fechaDate = new Date(fecha + 'T12:00:00Z');
    where.fechaInicio = { lte: fechaDate };
    where.fechaFin = { gte: fechaDate };
  } else {
    where.fechaFin = { gte: new Date() };
  }

  const bloqueos = await prisma.bloqueoAgenda.findMany({
    where: where as never,
    include: {
      profesional: {
        select: { id: true, nombres: true, apellidos: true, tipo: true, colorAvatar: true },
      },
      creadoPorUsuario: { select: { id: true, nombre: true } },
    },
    orderBy: [{ horaInicio: 'asc' }, { profesional: { nombres: 'asc' } }],
  });

  res.json(bloqueos);
});

// ─── GET /almuerzos/profesional/:profesionalId?sedeId=X ──────────────────────
router.get('/profesional/:profesionalId', requireAuth, async (req, res) => {
  const { sedeId } = req.query as { sedeId?: string };
  if (!sedeId) throw new AppError('sedeId requerido', 400);

  const bloqueo = await prisma.bloqueoAgenda.findFirst({
    where: {
      profesionalId: req.params.profesionalId,
      sedeId,
      tipo: 'ALMUERZO',
      esRecurrente: true,
      deletedAt: null,
    },
    include: {
      creadoPorUsuario: { select: { id: true, nombre: true } },
    },
  });

  res.json(bloqueo ?? null);
});

// ─── POST /almuerzos ──────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const { profesionalId, sedeId, horaInicio } = z
    .object({
      profesionalId: z.string().uuid(),
      sedeId: z.string().uuid(),
      horaInicio: z.enum(['12:00', '13:00', '14:00']),
    })
    .parse(req.body);

  const profesional = await prisma.profesional.findUnique({
    where: { id: profesionalId },
    include: { unidadNegocio: true },
  });
  if (!profesional || !profesional.activo || profesional.deletedAt) {
    throw new AppError('Profesional no encontrado', 404);
  }

  if (profesional.tipo !== 'podologa' && profesional.tipo !== 'fisioterapeuta') {
    throw new AppError('El almuerzo aplica solo a podólogas y fisioterapeutas.', 400);
  }

  if (profesional.tipo === 'fisioterapeuta') {
    const sede = await prisma.sede.findUnique({ where: { id: sedeId }, select: { nombre: true } });
    if (sede?.nombre !== NOMBRE_PAZ_SOLDAN) {
      throw new AppError('Las fisioterapeutas solo están en Paz Soldán.', 400);
    }
  }

  const usuarioId = req.user?.userId;
  if (!usuarioId) throw new AppError('No autenticado', 401);

  try {
    await crearAlmuerzo({ profesionalId, sedeId, horaInicio, creadoPor: usuarioId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al crear almuerzo';
    if (msg.includes('ya tiene un horario')) throw new AppError(msg, 409);
    if (msg.includes('no tiene asignación')) throw new AppError(msg, 422);
    throw new AppError(msg, 400);
  }

  const creado = await prisma.bloqueoAgenda.findFirst({
    where: { profesionalId, sedeId, tipo: 'ALMUERZO', esRecurrente: true, deletedAt: null },
    include: {
      profesional: { select: { id: true, nombres: true, apellidos: true } },
      creadoPorUsuario: { select: { id: true, nombre: true } },
    },
  });

  res.status(201).json(creado);
});

// ─── DELETE /almuerzos/:id ────────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  const bloqueo = await prisma.bloqueoAgenda.findUnique({
    where: { id: req.params.id },
  });
  if (!bloqueo || bloqueo.deletedAt) throw new AppError('Bloqueo no encontrado', 404);
  if (bloqueo.tipo !== 'ALMUERZO') {
    throw new AppError('Solo se pueden eliminar bloqueos de tipo almuerzo aquí.', 400);
  }

  await prisma.bloqueoAgenda.update({
    where: { id: req.params.id },
    data: { deletedAt: new Date() },
  });

  // Audit en AuditLog
  await prisma.auditLog.create({
    data: {
      usuarioId: req.user?.userId,
      accion: 'ALMUERZO_ELIMINADO',
      entidad: 'bloqueo_agenda',
      entidadId: bloqueo.id,
      antes: {
        profesionalId: bloqueo.profesionalId,
        sedeId: bloqueo.sedeId,
        horaInicio: bloqueo.horaInicio,
        horaFin: bloqueo.horaFin,
      },
      despues: { deletedAt: new Date().toISOString() },
      sedeId: bloqueo.sedeId ?? undefined,
      ip: req.ip,
    },
  });

  res.json({ ok: true });
});

export default router;
