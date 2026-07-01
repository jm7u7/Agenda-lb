import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { registrarAudit } from '../services/audit';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  const { sedeId, profesionalId, activa } = req.query as Record<string, string>;

  const asignaciones = await prisma.asignacionSede.findMany({
    where: {
      ...(sedeId && { sedeId }),
      ...(profesionalId && { profesionalId }),
      ...(activa !== undefined && { activa: activa === 'true' }),
    },
    include: {
      profesional: {
        select: { id: true, nombres: true, apellidos: true, tipo: true, colorAvatar: true, unidadNegocioId: true },
      },
      sede: { select: { id: true, nombre: true, color: true } },
    },
    orderBy: { fechaInicio: 'desc' },
  });

  res.json(asignaciones);
});

const asignacionSchema = z.object({
  profesionalId: z.string().uuid(),
  sedeId: z.string().uuid(),
  fechaInicio: z.string(),
  fechaFin: z.string().optional().nullable(),
});

router.post('/', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const data = asignacionSchema.parse(req.body);

  // Verificar que el profesional es fisioterapeuta solo puede ir a Paz Soldán
  const prof = await prisma.profesional.findUnique({
    where: { id: data.profesionalId },
    include: { unidadNegocio: true },
  });
  if (!prof) throw new AppError('Profesional no encontrado', 404);

  if (prof.tipo === 'fisioterapeuta') {
    const pazSoldan = await prisma.sede.findFirst({ where: { nombre: 'Paz Soldán', deletedAt: null } });
    if (pazSoldan && data.sedeId !== pazSoldan.id) {
      throw new AppError('Las fisioterapeutas solo pueden ser asignadas a Paz Soldán', 400, 'FISIO_SOLO_PAZ_SOLDAN');
    }
  }

  // Cerrar asignación activa anterior
  await prisma.asignacionSede.updateMany({
    where: { profesionalId: data.profesionalId, activa: true },
    data: { activa: false, fechaFin: new Date(data.fechaInicio) },
  });

  const asignacion = await prisma.asignacionSede.create({
    data: {
      profesionalId: data.profesionalId,
      sedeId: data.sedeId,
      fechaInicio: new Date(data.fechaInicio),
      fechaFin: data.fechaFin ? new Date(data.fechaFin) : null,
      activa: true,
    },
    include: {
      profesional: { select: { id: true, nombres: true, apellidos: true } },
      sede: { select: { id: true, nombre: true } },
    },
  });

  await registrarAudit({
    usuarioId: req.user?.userId,
    accion: 'crear_asignacion_sede',
    entidad: 'asignacion_sede',
    entidadId: asignacion.id,
    antes: null,
    despues: { profesionalId: data.profesionalId, sedeId: data.sedeId, fechaInicio: data.fechaInicio, fechaFin: data.fechaFin ?? null },
    ip: req.ip,
  });

  res.status(201).json(asignacion);
});

export default router;
