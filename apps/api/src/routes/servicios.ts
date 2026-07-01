import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  const { unidadNegocioId, activo } = req.query as Record<string, string>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = { deletedAt: null };
  if (unidadNegocioId) where.unidadNegocioId = unidadNegocioId;
  if (activo !== undefined) where.activo = activo === 'true';

  const servicios = await prisma.servicio.findMany({
    where,
    include: { unidadNegocio: { select: { id: true, nombre: true, color: true } } },
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

export default router;
