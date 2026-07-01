import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireScope } from '../middleware/auth';
import { calcularDisponibilidad } from '../services/disponibilidad';
import { AppError } from '../middleware/errorHandler';
import { prisma } from '../db';

const router = Router();

const querySchema = z.object({
  sede: z.string().uuid(),
  unidadNegocio: z.string().uuid(),
  servicio: z.string().uuid(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido (YYYY-MM-DD)'),
  profesional: z.string().uuid().optional(),
});

/**
 * @swagger
 * /api/v1/disponibilidad:
 *   get:
 *     summary: Consultar slots disponibles
 *     description: |
 *       Retorna los slots disponibles para una sede, unidad de negocio y servicio en una fecha.
 *       Si no se pasa `profesional` y la unidad tiene modo `preferencia_opcional` o `sin_eleccion`,
 *       retorna disponibilidad agregada (el slot está libre si al menos un profesional lo tiene).
 *       Este es el endpoint principal para el agente de WhatsApp (GoHighLevel).
 *     tags: [Disponibilidad]
 *     security:
 *       - bearerAuth: []
 *       - apiKey: []
 *     parameters:
 *       - in: query
 *         name: sede
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: unidadNegocio
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: servicio
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: fecha
 *         required: true
 *         schema: { type: string, example: "2026-06-15" }
 *       - in: query
 *         name: profesional
 *         schema: { type: string, format: uuid }
 *         description: Opcional; solo para unidades con preferencia
 *     responses:
 *       200:
 *         description: Lista de slots disponibles
 */
router.get('/', requireAuth, requireScope('availability:read'), async (req, res) => {
  const params = querySchema.parse(req.query);

  // Validar que la unidad opera en la sede
  const sedeUnidad = await prisma.sedeUnidadNegocio.findUnique({
    where: { sedeId_unidadNegocioId: { sedeId: params.sede, unidadNegocioId: params.unidadNegocio } },
  });
  if (!sedeUnidad) {
    throw new AppError('La unidad de negocio no opera en esta sede', 400, 'UNIDAD_NO_EN_SEDE');
  }

  const slots = await calcularDisponibilidad({
    sedeId: params.sede,
    unidadNegocioId: params.unidadNegocio,
    servicioId: params.servicio,
    fecha: params.fecha,
    profesionalId: params.profesional,
  });

  const servicio = await prisma.servicio.findUnique({
    where: { id: params.servicio },
    select: { duracionMinutos: true },
  });

  res.json({
    fecha: params.fecha,
    sedeId: params.sede,
    unidadNegocioId: params.unidadNegocio,
    servicioId: params.servicio,
    profesionalId: params.profesional ?? null,
    duracionMinutos: servicio?.duracionMinutos ?? 30,
    slots: slots.filter(s => s.disponible),
    todos: slots,
  });
});

export default router;
