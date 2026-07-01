import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { auditEnTx } from '../services/audit';

const router = Router();
const requireAdmin = requireRol('admin');

// Servicio embebido en respuestas de combinación (para selectores del frontend).
const servicioSelect = {
  id: true, nombre: true, color: true, duracionMinutos: true, unidadNegocioId: true, activo: true,
} as const;

// ─── GET /combinaciones/config ────────────────────────────────────────────────
// Lectura para el POPOVER (cualquier usuario autenticado): el servicio ancla
// configurado + los extras ACTIVOS permitidos. Si no hay ancla, el toggle no aparece.
router.get('/config', requireAuth, async (_req, res) => {
  const [servicioAnclaId, combinables] = await Promise.all([
    prisma.configuracionSistema
      .findFirst({ orderBy: { actualizadoEn: 'desc' }, select: { servicioAnclaId: true } })
      .then((c) => c?.servicioAnclaId ?? null),
    prisma.combinacionPermitida.findMany({
      where: { activo: true, deletedAt: null },
      include: { servicio: { select: servicioSelect } },
      orderBy: { creadoEn: 'asc' },
    }),
  ]);
  res.json({
    servicioAnclaId,
    combinables: combinables.map((c) => ({ id: c.id, servicioExtraId: c.servicioExtraId, servicio: c.servicio })),
  });
});

// ─── GET /combinaciones/admin ─────────────────────────────────────────────────
// Gestión (admin): incluye inactivos. Para la sección de Herramientas.
router.get('/admin', requireAuth, requireAdmin, async (_req, res) => {
  const combinaciones = await prisma.combinacionPermitida.findMany({
    where: { deletedAt: null },
    include: { servicio: { select: servicioSelect } },
    orderBy: { creadoEn: 'asc' },
  });
  res.json(combinaciones.map((c) => ({
    id: c.id, servicioExtraId: c.servicioExtraId, activo: c.activo, servicio: c.servicio,
  })));
});

// ─── PUT /combinaciones/ancla ─────────────────────────────────────────────────
// Define (o limpia) el servicio ancla. Fila única en ConfiguracionSistema.
router.put('/ancla', requireAuth, requireAdmin, async (req, res) => {
  const { servicioAnclaId } = z
    .object({ servicioAnclaId: z.string().uuid().nullable() })
    .parse(req.body);

  if (servicioAnclaId) {
    const srv = await prisma.servicio.findUnique({ where: { id: servicioAnclaId } });
    if (!srv || srv.deletedAt) throw new AppError('Servicio ancla no encontrado', 404);
  }

  const existente = await prisma.configuracionSistema.findFirst({ orderBy: { actualizadoEn: 'desc' } });

  const guardado = await prisma.$transaction(async (tx) => {
    const cfg = existente
      ? await tx.configuracionSistema.update({ where: { id: existente.id }, data: { servicioAnclaId } })
      : await tx.configuracionSistema.create({ data: { servicioAnclaId } });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId,
      accion: 'config_ancla_combinacion',
      entidad: 'configuracion_sistema',
      entidadId: cfg.id,
      antes: { servicioAnclaId: existente?.servicioAnclaId ?? null },
      despues: { servicioAnclaId },
      ip: req.ip,
    });
    return cfg;
  });

  res.json({ servicioAnclaId: guardado.servicioAnclaId });
});

// ─── POST /combinaciones ──────────────────────────────────────────────────────
// Agrega un servicio extra combinable (o reactiva uno previamente quitado).
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { servicioExtraId } = z.object({ servicioExtraId: z.string().uuid() }).parse(req.body);

  const srv = await prisma.servicio.findUnique({ where: { id: servicioExtraId } });
  if (!srv || srv.deletedAt) throw new AppError('Servicio no encontrado', 404);

  const ancla = await prisma.configuracionSistema.findFirst({ orderBy: { actualizadoEn: 'desc' } });
  if (ancla?.servicioAnclaId === servicioExtraId) {
    throw new AppError('El servicio ancla no puede ser su propio extra combinable', 400, 'ANCLA_NO_ES_EXTRA');
  }

  const existente = await prisma.combinacionPermitida.findFirst({ where: { servicioExtraId, deletedAt: null } });
  if (existente?.activo) throw new AppError('Ese servicio ya está en la lista de combinables', 409, 'COMBINACION_DUPLICADA');

  const guardado = await prisma.$transaction(async (tx) => {
    const c = existente
      ? await tx.combinacionPermitida.update({ where: { id: existente.id }, data: { activo: true, deletedAt: null } })
      : await tx.combinacionPermitida.create({ data: { servicioExtraId } });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId,
      accion: existente ? 'reactivar_combinacion' : 'crear_combinacion',
      entidad: 'combinacion_permitida',
      entidadId: c.id,
      despues: { servicioExtraId, activo: true },
      ip: req.ip,
    });
    return c;
  });

  const conServicio = await prisma.combinacionPermitida.findUnique({
    where: { id: guardado.id }, include: { servicio: { select: servicioSelect } },
  });
  res.status(201).json(conServicio);
});

// ─── PATCH /combinaciones/:id ─────────────────────────────────────────────────
// Activar / desactivar un combinable sin perderlo de la lista.
router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { activo } = z.object({ activo: z.boolean() }).parse(req.body);
  const existente = await prisma.combinacionPermitida.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!existente) throw new AppError('Combinación no encontrada', 404);

  await prisma.$transaction(async (tx) => {
    await tx.combinacionPermitida.update({ where: { id: existente.id }, data: { activo } });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId,
      accion: activo ? 'activar_combinacion' : 'desactivar_combinacion',
      entidad: 'combinacion_permitida',
      entidadId: existente.id,
      antes: { activo: existente.activo },
      despues: { activo },
      ip: req.ip,
    });
  });

  const conServicio = await prisma.combinacionPermitida.findUnique({
    where: { id: existente.id }, include: { servicio: { select: servicioSelect } },
  });
  res.json(conServicio);
});

// ─── DELETE /combinaciones/:id ────────────────────────────────────────────────
// Quita de la lista (soft-delete). No afecta bloques ya creados.
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const existente = await prisma.combinacionPermitida.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!existente) throw new AppError('Combinación no encontrada', 404);

  await prisma.$transaction(async (tx) => {
    await tx.combinacionPermitida.update({ where: { id: existente.id }, data: { activo: false, deletedAt: new Date() } });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId,
      accion: 'eliminar_combinacion',
      entidad: 'combinacion_permitida',
      entidadId: existente.id,
      antes: { servicioExtraId: existente.servicioExtraId, activo: existente.activo },
      despues: { deletedAt: new Date().toISOString() },
      ip: req.ip,
    });
  });

  res.json({ ok: true });
});

export default router;
