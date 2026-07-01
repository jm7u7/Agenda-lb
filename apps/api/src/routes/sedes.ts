import { Router } from 'express';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();

router.get('/', requireAuth, async (_req, res) => {
  const sedes = await prisma.sede.findMany({
    where: { deletedAt: null },
    include: {
      unidadesNegocio: {
        include: { unidadNegocio: { select: { id: true, nombre: true, modoReserva: true, color: true } } },
      },
    },
    orderBy: { nombre: 'asc' },
  });

  res.json(sedes.map((s: typeof sedes[number]) => ({
    id: s.id,
    nombre: s.nombre,
    direccion: s.direccion,
    color: s.color,
    activa: s.activa,
    horario: s.horario,
    unidadesNegocio: s.unidadesNegocio.map((u: { unidadNegocio: unknown }) => u.unidadNegocio),
  })));
});

router.get('/:id', requireAuth, async (req, res) => {
  const sede = await prisma.sede.findUnique({
    where: { id: req.params.id, deletedAt: null },
    include: {
      unidadesNegocio: {
        include: { unidadNegocio: true },
      },
    },
  });
  if (!sede) throw new AppError('Sede no encontrada', 404);
  res.json(sede);
});

export default router;
