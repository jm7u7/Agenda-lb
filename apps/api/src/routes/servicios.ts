import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { auditEnTx } from '../services/audit';

const router = Router();

// Include de subcategorías ACTIVAS ordenadas — se adjunta a cada servicio para que
// la agenda/membresías sepan si hay que elegir una (Profilaxis → Regular/Premium/…).
const subcategoriasInclude = {
  subcategorias: {
    where: { deletedAt: null, activo: true },
    orderBy: [{ orden: 'asc' as const }, { nombre: 'asc' as const }],
    select: { id: true, nombre: true, precioReferencial: true, orden: true },
  },
};

router.get('/', requireAuth, async (req, res) => {
  const { unidadNegocioId, activo } = req.query as Record<string, string>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = { deletedAt: null };
  if (unidadNegocioId) where.unidadNegocioId = unidadNegocioId;
  if (activo !== undefined) where.activo = activo === 'true';

  const servicios = await prisma.servicio.findMany({
    where,
    include: { unidadNegocio: { select: { id: true, nombre: true, color: true } }, ...subcategoriasInclude },
    // `orden` manual primero (Promociones mantiene su secuencia); el resto (orden=0) alfabético.
    orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
  });

  res.json(servicios);
});

router.get('/:id', requireAuth, async (req, res) => {
  const s = await prisma.servicio.findUnique({
    where: { id: req.params.id, deletedAt: null },
    include: { unidadNegocio: true },
  });
  if (!s) throw new (await import('../middleware/errorHandler')).AppError('Servicio no encontrado', 404);
  res.json(s);
});

const servicioSchema = z.object({
  nombre: z.string().min(3),
  codigo: z.string().min(2).optional(), // se genera automáticamente (PREFIJO-NN por unidad)
  duracionMinutos: z.number().int().positive(),
  color: z.string().default('#6B7F9E'),
  precioReferencial: z.number().positive().optional(),
  unidadNegocioId: z.string().uuid(),
  activo: z.boolean().default(true),
});

// Prefijo de código según la unidad (consistente: POD-/BAR-/FIS-, o 3 letras del nombre).
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function prefijoUnidad(nombre: string): string {
  const n = norm(nombre);
  if (n.startsWith('podolog')) return 'POD';
  if (n.startsWith('baropodometr')) return 'BAR';
  if (n.startsWith('fisio')) return 'FIS';
  return n.replace(/[^a-z]/g, '').slice(0, 3).toUpperCase() || 'SRV';
}
async function generarCodigo(unidadNegocioId: string): Promise<string> {
  const unidad = await prisma.unidadNegocio.findUnique({ where: { id: unidadNegocioId }, select: { nombre: true } });
  const prefijo = prefijoUnidad(unidad?.nombre ?? '');
  const existentes = await prisma.servicio.findMany({ where: { codigo: { startsWith: `${prefijo}-` } }, select: { codigo: true } });
  let max = 0;
  for (const e of existentes) {
    const m = e.codigo.match(new RegExp(`^${prefijo}-(\\d+)$`));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefijo}-${String(max + 1).padStart(2, '0')}`;
}

router.post('/', requireAuth, requireRol('admin'), async (req, res) => {
  const data = servicioSchema.parse(req.body);
  // El código se asigna automáticamente para mantener el formato consistente por unidad.
  const codigo = await generarCodigo(data.unidadNegocioId);
  const servicio = await prisma.servicio.create({ data: { ...data, codigo, precioReferencial: data.precioReferencial as never } });
  res.status(201).json(servicio);
});

router.patch('/:id', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const data = servicioSchema.partial().parse(req.body);
  const servicio = await prisma.servicio.update({
    where: { id: req.params.id, deletedAt: null },
    data: { ...data, precioReferencial: data.precioReferencial as never },
  });
  res.json(servicio);
});

// ─── Subcategorías de un servicio (ej. Profilaxis → Regular/Premium/…) ────────
// Al agendar o vender/consumir membresías de un servicio con subcategorías activas,
// elegir una es obligatorio (validado en citas.ts / membresias.ts). Soft-delete.
const subcategoriaSchema = z.object({
  nombre: z.string().trim().min(2).max(80),
  precioReferencial: z.number().positive().nullable().optional(),
  orden: z.number().int().min(0).optional(),
});

// GET /servicios/:id/subcategorias — lista (incluye inactivas para administración).
router.get('/:id/subcategorias', requireAuth, async (req, res) => {
  const subs = await prisma.subcategoriaServicio.findMany({
    where: { servicioId: req.params.id, deletedAt: null },
    orderBy: [{ activo: 'desc' }, { orden: 'asc' }, { nombre: 'asc' }],
  });
  res.json(subs);
});

// POST /servicios/:id/subcategorias — crear (admin).
router.post('/:id/subcategorias', requireAuth, requireRol('admin'), async (req, res) => {
  const data = subcategoriaSchema.parse(req.body);
  const servicio = await prisma.servicio.findFirst({ where: { id: req.params.id, deletedAt: null }, select: { id: true } });
  if (!servicio) throw new AppError('Servicio no encontrado', 404);
  const existe = await prisma.subcategoriaServicio.findFirst({
    where: { servicioId: servicio.id, nombre: data.nombre, deletedAt: null },
    select: { id: true },
  });
  if (existe) throw new AppError('Ya existe una subcategoría con ese nombre', 409, 'SUBCATEGORIA_DUPLICADA');
  const sub = await prisma.$transaction(async (tx) => {
    const creada = await tx.subcategoriaServicio.create({
      data: { servicioId: servicio.id, nombre: data.nombre, precioReferencial: data.precioReferencial as never, orden: data.orden ?? 0 },
    });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId,
      accion: 'crear_subcategoria_servicio',
      entidad: 'subcategoria_servicio',
      entidadId: creada.id,
      despues: { servicioId: servicio.id, nombre: data.nombre, precioReferencial: data.precioReferencial ?? null },
      ip: req.ip,
    });
    return creada;
  });
  res.status(201).json(sub);
});

// PATCH /servicios/subcategorias/:subId — editar (admin/coordinadora).
router.patch('/subcategorias/:subId', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const data = subcategoriaSchema.partial().extend({ activo: z.boolean().optional() }).parse(req.body);
  const actual = await prisma.subcategoriaServicio.findFirst({ where: { id: req.params.subId, deletedAt: null } });
  if (!actual) throw new AppError('Subcategoría no encontrada', 404);
  if (data.nombre && data.nombre !== actual.nombre) {
    const dup = await prisma.subcategoriaServicio.findFirst({
      where: { servicioId: actual.servicioId, nombre: data.nombre, deletedAt: null, NOT: { id: actual.id } },
      select: { id: true },
    });
    if (dup) throw new AppError('Ya existe una subcategoría con ese nombre', 409, 'SUBCATEGORIA_DUPLICADA');
  }
  const sub = await prisma.$transaction(async (tx) => {
    const upd = await tx.subcategoriaServicio.update({
      where: { id: actual.id },
      data: {
        ...(data.nombre !== undefined ? { nombre: data.nombre } : {}),
        ...(data.precioReferencial !== undefined ? { precioReferencial: data.precioReferencial as never } : {}),
        ...(data.orden !== undefined ? { orden: data.orden } : {}),
        ...(data.activo !== undefined ? { activo: data.activo } : {}),
      },
    });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId,
      accion: 'editar_subcategoria_servicio',
      entidad: 'subcategoria_servicio',
      entidadId: actual.id,
      antes: { nombre: actual.nombre, precioReferencial: actual.precioReferencial, orden: actual.orden, activo: actual.activo },
      despues: data,
      ip: req.ip,
    });
    return upd;
  });
  res.json(sub);
});

// DELETE /servicios/subcategorias/:subId — desactivar (soft, admin). Las citas
// históricas conservan su subcategoriaId (FK ON DELETE SET NULL nunca se dispara).
router.delete('/subcategorias/:subId', requireAuth, requireRol('admin'), async (req, res) => {
  const actual = await prisma.subcategoriaServicio.findFirst({ where: { id: req.params.subId, deletedAt: null } });
  if (!actual) throw new AppError('Subcategoría no encontrada', 404);
  await prisma.$transaction(async (tx) => {
    await tx.subcategoriaServicio.update({ where: { id: actual.id }, data: { deletedAt: new Date(), activo: false } });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId,
      accion: 'eliminar_subcategoria_servicio',
      entidad: 'subcategoria_servicio',
      entidadId: actual.id,
      antes: { nombre: actual.nombre, activo: actual.activo },
      despues: { deletedAt: new Date().toISOString() },
      ip: req.ip,
    });
  });
  res.json({ ok: true });
});

export default router;
