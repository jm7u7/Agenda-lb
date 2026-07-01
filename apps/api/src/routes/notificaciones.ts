import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();

const requireCoord = requireRol('admin', 'coordinadora_sedes');

const INCLUDE_AUTOR = {
  autor: { select: { id: true, nombre: true } },
  sedes: { include: { sede: { select: { id: true, nombre: true } } } },
} as const;

// ─── GET /notificaciones/activas ─────────────────────────────────────────────
// Devuelve notificaciones activas para el usuario autenticado (sin filtrar por vistas).
router.get('/activas', requireAuth, async (req, res) => {
  const usuarioId = req.user!.userId;
  const now = new Date();

  const usuario = await prisma.usuario.findUnique({
    where: { id: usuarioId },
    include: { sedes: { select: { sedeId: true } } },
  });
  if (!usuario) throw new AppError('Usuario no encontrado', 404);

  const sedeIds = usuario.sedes.map(s => s.sedeId);

  const notificaciones = await prisma.notificacion.findMany({
    where: {
      activaDesde: { lte: now },
      activaHasta: { gte: now },
      OR: [
        { todasLasSedes: true },
        { sedes: { some: { sedeId: { in: sedeIds } } } },
      ],
    },
    include: {
      ...INCLUDE_AUTOR,
      vistas: { where: { usuarioId }, select: { id: true } },
    },
    orderBy: { creadoEn: 'desc' },
  });

  // Solo las que el usuario no ha visto aún
  const noVistas = notificaciones.filter(n => n.vistas.length === 0);

  res.json(noVistas.map(n => ({
    id: n.id,
    mensaje: n.mensaje,
    activaHasta: n.activaHasta,
    todasLasSedes: n.todasLasSedes,
    creadoEn: n.creadoEn,
    autor: n.autor,
    sedes: n.sedes.map(s => s.sede),
  })));
});

// ─── POST /notificaciones/:id/vista ─────────────────────────────────────────
router.post('/:id/vista', requireAuth, async (req, res) => {
  const usuarioId = req.user!.userId;
  const notificacionId = req.params.id;

  const existe = await prisma.notificacion.findUnique({ where: { id: notificacionId } });
  if (!existe) throw new AppError('Notificación no encontrada', 404);

  await prisma.notificacionVista.upsert({
    where: { notificacionId_usuarioId: { notificacionId, usuarioId } },
    create: { notificacionId, usuarioId },
    update: {},
  });

  res.json({ ok: true });
});

// ─── GET /admin/notificaciones ───────────────────────────────────────────────
router.get('/admin', requireAuth, requireCoord, async (_req, res) => {
  const now = new Date();

  const notificaciones = await prisma.notificacion.findMany({
    include: {
      ...INCLUDE_AUTOR,
      _count: { select: { vistas: true } },
    },
    orderBy: { creadoEn: 'desc' },
    take: 50,
  });

  res.json(notificaciones.map(n => ({
    id: n.id,
    mensaje: n.mensaje,
    activaDesde: n.activaDesde,
    activaHasta: n.activaHasta,
    todasLasSedes: n.todasLasSedes,
    creadoEn: n.creadoEn,
    autor: n.autor,
    sedes: n.sedes.map(s => s.sede),
    totalVistas: n._count.vistas,
    estaActiva: n.activaDesde <= now && n.activaHasta >= now,
  })));
});

// ─── POST /admin/notificaciones ──────────────────────────────────────────────
router.post('/admin', requireAuth, requireCoord, async (req, res) => {
  const schema = z.object({
    mensaje: z.string().min(1).max(500),
    activaHasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    todasLasSedes: z.boolean(),
    sedeIds: z.array(z.string().uuid()).optional(),
  });

  const data = schema.parse(req.body);
  const activaHasta = new Date(data.activaHasta + 'T23:59:59');
  const now = new Date();

  if (activaHasta <= now) {
    throw new AppError('La fecha de vencimiento debe ser futura', 400, 'FECHA_PASADA');
  }

  const notificacion = await prisma.notificacion.create({
    data: {
      mensaje: data.mensaje,
      creadoPor: req.user!.userId,
      activaHasta,
      todasLasSedes: data.todasLasSedes,
      sedes: (!data.todasLasSedes && data.sedeIds?.length)
        ? { create: data.sedeIds.map(sedeId => ({ sedeId })) }
        : undefined,
    },
    include: { ...INCLUDE_AUTOR, _count: { select: { vistas: true } } },
  });

  res.status(201).json({
    ...notificacion,
    totalVistas: notificacion._count.vistas,
    estaActiva: true,
    sedes: notificacion.sedes.map(s => s.sede),
  });
});

// ─── PUT /admin/notificaciones/:id ──────────────────────────────────────────
router.put('/admin/:id', requireAuth, requireCoord, async (req, res) => {
  const schema = z.object({
    mensaje: z.string().min(1).max(500).optional(),
    activaHasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    todasLasSedes: z.boolean().optional(),
    sedeIds: z.array(z.string().uuid()).optional(),
  });

  const data = schema.parse(req.body);
  const existing = await prisma.notificacion.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new AppError('Notificación no encontrada', 404);

  const now = new Date();
  if (existing.activaHasta < now) {
    throw new AppError('No se puede editar una notificación ya vencida', 400, 'YA_VENCIDA');
  }

  let activaHasta = existing.activaHasta;
  if (data.activaHasta) {
    activaHasta = new Date(data.activaHasta + 'T23:59:59');
    if (activaHasta <= now) {
      throw new AppError('La nueva fecha de vencimiento debe ser futura', 400, 'FECHA_PASADA');
    }
  }

  await prisma.$transaction(async (tx) => {
    if (data.todasLasSedes !== undefined && !data.todasLasSedes && data.sedeIds) {
      await tx.notificacionSede.deleteMany({ where: { notificacionId: req.params.id } });
      await tx.notificacionSede.createMany({
        data: data.sedeIds.map(sedeId => ({ notificacionId: req.params.id, sedeId })),
      });
    }
    await tx.notificacion.update({
      where: { id: req.params.id },
      data: {
        ...(data.mensaje ? { mensaje: data.mensaje } : {}),
        activaHasta,
        ...(data.todasLasSedes !== undefined ? { todasLasSedes: data.todasLasSedes } : {}),
      },
    });
  });

  const updated = await prisma.notificacion.findUnique({
    where: { id: req.params.id },
    include: { ...INCLUDE_AUTOR, _count: { select: { vistas: true } } },
  });

  res.json({
    ...updated,
    totalVistas: updated!._count.vistas,
    estaActiva: updated!.activaDesde <= now && updated!.activaHasta >= now,
    sedes: updated!.sedes.map((s: { sede: { id: string; nombre: string } }) => s.sede),
  });
});

// ─── DELETE /admin/notificaciones/:id ───────────────────────────────────────
router.delete('/admin/:id', requireAuth, requireCoord, async (req, res) => {
  const existing = await prisma.notificacion.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { vistas: true } } },
  });
  if (!existing) throw new AppError('Notificación no encontrada', 404);

  if (existing._count.vistas > 0) {
    throw new AppError(
      `Esta notificación ya fue vista por ${existing._count.vistas} usuario${existing._count.vistas !== 1 ? 's' : ''}. Para desactivarla, edita la fecha de vencimiento a hoy.`,
      409,
      'TIENE_VISTAS',
    );
  }

  await prisma.notificacion.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

export default router;
