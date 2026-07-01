import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { auditEnTx } from '../services/audit';

const router = Router();
const requireGestor = requireRol('admin', 'coordinadora_sedes');

const promoSelect = { id: true, nombre: true, descripcion: true, tipo: true, valor: true, activo: true, orden: true } as const;

const promoBodySchema = z.object({
  nombre: z.string().trim().min(2).max(160),
  descripcion: z.string().trim().max(500).optional(),
  tipo: z.enum(['PRECIO_FIJO', 'PORCENTAJE', 'OTRO']).default('OTRO'),
  valor: z.number().nonnegative().nullable().optional(),
});

// GET /promociones — activas (para el desplegable de la cita).
router.get('/', requireAuth, async (_req, res) => {
  const promos = await prisma.promocion.findMany({
    where: { activo: true, deletedAt: null },
    orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    select: promoSelect,
  });
  res.json(promos);
});

// GET /promociones/todas — incl. inactivas + conteo de uso (citas VIVAS). Para gestión.
router.get('/todas', requireAuth, requireGestor, async (_req, res) => {
  const promos = await prisma.promocion.findMany({
    where: { deletedAt: null },
    orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    select: promoSelect,
  });
  // enUso = citas VIVAS (deletedAt null) con esa promocionId. Como la promo vive solo en la
  // cita portadora del bloque, este conteo ya es por-bloque correcto.
  const usos = await prisma.cita.groupBy({
    by: ['promocionId'],
    where: { promocionId: { not: null }, deletedAt: null },
    _count: { _all: true },
  });
  const usoMap = new Map(usos.map(u => [u.promocionId, u._count._all]));
  res.json(promos.map(p => ({ ...p, enUso: usoMap.get(p.id) ?? 0 })));
});

// POST /promociones — crear (o reactivar si existía una inactiva con ese nombre).
router.post('/', requireAuth, requireGestor, async (req, res) => {
  const data = promoBodySchema.parse(req.body);
  const nombre = data.nombre.trim();
  const valor = data.valor ?? null;

  const existente = await prisma.promocion.findFirst({ where: { nombre, deletedAt: null } });
  if (existente && existente.activo) throw new AppError('Ya existe una promoción con ese nombre', 409, 'PROMO_DUPLICADA');

  const max = await prisma.promocion.aggregate({ _max: { orden: true } });
  const promo = await prisma.$transaction(async (tx) => {
    const p = existente
      ? await tx.promocion.update({ where: { id: existente.id }, data: { activo: true, deletedAt: null, descripcion: data.descripcion ?? null, tipo: data.tipo, valor } })
      : await tx.promocion.create({ data: { nombre, descripcion: data.descripcion ?? null, tipo: data.tipo, valor, orden: (max._max.orden ?? 0) + 1 } });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId, accion: existente ? 'reactivar_promocion' : 'crear_promocion',
      entidad: 'promocion', entidadId: p.id, despues: { nombre, tipo: data.tipo, valor }, ip: req.ip,
    });
    return p;
  });
  res.status(201).json(promo);
});

// PATCH /promociones/:id — renombrar / activar-desactivar / tipo+valor / orden / descripción.
router.patch('/:id', requireAuth, requireGestor, async (req, res) => {
  const data = z.object({
    nombre: z.string().trim().min(2).max(160).optional(),
    descripcion: z.string().trim().max(500).nullable().optional(),
    tipo: z.enum(['PRECIO_FIJO', 'PORCENTAJE', 'OTRO']).optional(),
    valor: z.number().nonnegative().nullable().optional(),
    activo: z.boolean().optional(),
    orden: z.number().int().optional(),
  }).parse(req.body);

  const promo = await prisma.promocion.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!promo) throw new AppError('Promoción no encontrada', 404);

  if (data.nombre && data.nombre.trim() !== promo.nombre) {
    const choque = await prisma.promocion.findFirst({ where: { nombre: data.nombre.trim(), deletedAt: null, id: { not: promo.id } } });
    if (choque) throw new AppError('Ya existe otra promoción con ese nombre', 409, 'PROMO_DUPLICADA');
  }

  const actualizado = await prisma.$transaction(async (tx) => {
    const p = await tx.promocion.update({
      where: { id: promo.id },
      data: {
        ...(data.nombre !== undefined ? { nombre: data.nombre.trim() } : {}),
        ...(data.descripcion !== undefined ? { descripcion: data.descripcion } : {}),
        ...(data.tipo !== undefined ? { tipo: data.tipo } : {}),
        ...(data.valor !== undefined ? { valor: data.valor } : {}),
        ...(data.activo !== undefined ? { activo: data.activo } : {}),
        ...(data.orden !== undefined ? { orden: data.orden } : {}),
      },
    });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId, accion: 'editar_promocion', entidad: 'promocion', entidadId: p.id,
      antes: { nombre: promo.nombre, tipo: promo.tipo, valor: promo.valor, activo: promo.activo },
      despues: { nombre: p.nombre, tipo: p.tipo, valor: p.valor, activo: p.activo }, ip: req.ip,
    });
    return p;
  });
  res.json(actualizado);
});

// DELETE /promociones/:id — quitar: si tiene citas VIVAS, solo se desactiva (conserva
// historial + FK RESTRICT); si no, soft-delete real.
router.delete('/:id', requireAuth, requireGestor, async (req, res) => {
  const promo = await prisma.promocion.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!promo) throw new AppError('Promoción no encontrada', 404);

  const enUso = await prisma.cita.count({ where: { promocionId: promo.id, deletedAt: null } });
  await prisma.$transaction(async (tx) => {
    if (enUso > 0) {
      await tx.promocion.update({ where: { id: promo.id }, data: { activo: false } });
    } else {
      await tx.promocion.update({ where: { id: promo.id }, data: { activo: false, deletedAt: new Date() } });
    }
    await auditEnTx(tx, {
      usuarioId: req.user?.userId, accion: enUso > 0 ? 'desactivar_promocion' : 'eliminar_promocion',
      entidad: 'promocion', entidadId: promo.id, antes: { nombre: promo.nombre, activo: promo.activo },
      despues: enUso > 0 ? { activo: false } : { deletedAt: new Date().toISOString() }, ip: req.ip,
    });
  });
  res.json(enUso > 0 ? { ok: true, desactivado: true, enUso } : { ok: true, eliminado: true });
});

export default router;
