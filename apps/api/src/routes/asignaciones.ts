import { Router } from 'express';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';

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

// NOTA: el antiguo `POST /asignaciones` (creación directa) se ELIMINÓ. Cerraba TODAS
// las asignaciones activas a ciegas (updateMany sin `cierraAsignacionId`), lo que dejaba
// a la profesional imposible de "deshacer" y era una vía de que Movimientos pisara
// vacaciones. Toda creación/mover va por `POST /movimientos` (asignacionService), que sí
// es trazable y ahora valida contra vacaciones. Este router queda solo-lectura (GET).

export default router;
