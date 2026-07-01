import { Router } from 'express';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const {
    sedeId, usuarioId, pacienteId, entidad,
    desde, hasta, page = '1', limit = '50',
  } = req.query as Record<string, string>;

  const skip = (Number(page) - 1) * Number(limit);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {};
  if (sedeId) where.sedeId = sedeId;
  if (usuarioId) where.usuarioId = usuarioId;
  if (entidad) where.entidad = entidad;
  if (desde || hasta) {
    where.creadoEn = {};
    if (desde) where.creadoEn.gte = new Date(desde);
    if (hasta) where.creadoEn.lte = new Date(hasta);
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        usuario: { select: { id: true, nombre: true, email: true } },
        cita: {
          select: {
            id: true,
            paciente: { select: { nombres: true, apellidoPaterno: true } },
          },
        },
      },
      orderBy: { creadoEn: 'desc' },
      skip,
      take: Number(limit),
    }),
    prisma.auditLog.count({ where }),
  ]);

  res.json({
    data: logs,
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / Number(limit)),
  });
});

export default router;
