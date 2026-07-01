import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();
const requireGestor = requireRol('admin', 'coordinadora_sedes');

// slug estable a partir de la etiqueta
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

// GET /canales — activos (para selectores de reserva)
router.get('/', requireAuth, async (_req, res) => {
  const canales = await prisma.canal.findMany({
    where: { activo: true, deletedAt: null },
    orderBy: { orden: 'asc' },
    select: { id: true, valor: true, etiqueta: true, orden: true },
  });
  res.json(canales);
});

// GET /canales/todos — incluye inactivos + conteo de uso (gestión)
router.get('/todos', requireAuth, requireGestor, async (_req, res) => {
  const canales = await prisma.canal.findMany({ where: { deletedAt: null }, orderBy: { orden: 'asc' } });
  const usos = await prisma.cita.groupBy({ by: ['canal'], _count: { _all: true } });
  const usoMap = new Map(usos.map(u => [u.canal, u._count._all]));
  res.json(canales.map(c => ({ ...c, enUso: usoMap.get(c.valor) ?? 0 })));
});

// POST /canales — crear (o reactivar si existía inactivo)
router.post('/', requireAuth, requireGestor, async (req, res) => {
  const { etiqueta } = z.object({ etiqueta: z.string().min(2).max(60) }).parse(req.body);
  const valor = slug(etiqueta);
  if (!valor) throw new AppError('El nombre no es válido', 400);

  const existente = await prisma.canal.findUnique({ where: { valor } });
  if (existente) {
    if (existente.activo && !existente.deletedAt) throw new AppError('Ya existe un canal con ese nombre', 409, 'CANAL_DUPLICADO');
    const reactivado = await prisma.canal.update({ where: { id: existente.id }, data: { activo: true, deletedAt: null, etiqueta: etiqueta.trim() } });
    return res.status(201).json(reactivado);
  }
  const max = await prisma.canal.aggregate({ _max: { orden: true } });
  const canal = await prisma.canal.create({ data: { valor, etiqueta: etiqueta.trim(), orden: (max._max.orden ?? 0) + 1, activo: true } });
  res.status(201).json(canal);
});

// PATCH /canales/:id — renombrar / activar-desactivar / reordenar
router.patch('/:id', requireAuth, requireGestor, async (req, res) => {
  const data = z.object({
    etiqueta: z.string().min(2).max(60).optional(),
    activo: z.boolean().optional(),
    orden: z.number().int().optional(),
  }).parse(req.body);
  const canal = await prisma.canal.findUnique({ where: { id: req.params.id } });
  if (!canal || canal.deletedAt) throw new AppError('Canal no encontrado', 404);
  const updated = await prisma.canal.update({ where: { id: canal.id }, data });
  res.json(updated);
});

// DELETE /canales/:id — quitar: si tiene citas, se desactiva (conserva historial); si no, se elimina.
router.delete('/:id', requireAuth, requireGestor, async (req, res) => {
  const canal = await prisma.canal.findUnique({ where: { id: req.params.id } });
  if (!canal || canal.deletedAt) throw new AppError('Canal no encontrado', 404);
  const enUso = await prisma.cita.count({ where: { canal: canal.valor } });
  if (enUso > 0) {
    await prisma.canal.update({ where: { id: canal.id }, data: { activo: false } });
    return res.json({ ok: true, desactivado: true, enUso });
  }
  await prisma.canal.update({ where: { id: canal.id }, data: { deletedAt: new Date(), activo: false } });
  res.json({ ok: true, eliminado: true });
});

export default router;
