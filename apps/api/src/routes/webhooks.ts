import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';

const router = Router();

const subSchema = z.object({
  nombre: z.string().min(3),
  url: z.string().url(),
  secret: z.string().min(16),
  eventos: z.array(z.enum(['appointment.created', 'appointment.rescheduled', 'appointment.cancelled', 'appointment.completed'])),
  sedeId: z.string().uuid().optional(),
});

router.get('/', requireAuth, requireRol('admin'), async (_req, res) => {
  const subs = await prisma.webhookSubscription.findMany({
    where: { deletedAt: null },
    include: { sede: { select: { id: true, nombre: true } } },
  });
  res.json(subs);
});

router.post('/', requireAuth, requireRol('admin'), async (req, res) => {
  const data = subSchema.parse(req.body);
  const sub = await prisma.webhookSubscription.create({ data });
  res.status(201).json(sub);
});

router.patch('/:id', requireAuth, requireRol('admin'), async (req, res) => {
  const data = subSchema.partial().parse(req.body);
  const sub = await prisma.webhookSubscription.update({
    where: { id: req.params.id, deletedAt: null },
    data,
  });
  res.json(sub);
});

router.delete('/:id', requireAuth, requireRol('admin'), async (req, res) => {
  await prisma.webhookSubscription.update({
    where: { id: req.params.id },
    data: { deletedAt: new Date() },
  });
  res.json({ ok: true });
});

export default router;
