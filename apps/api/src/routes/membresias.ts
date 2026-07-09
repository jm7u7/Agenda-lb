/**
 * Constructor de Membresías (Herramientas) — las membresías VIVEN en el módulo
 * Promociones (tipo MEMBRESIA) con su contabilidad de sesiones en una plantilla
 * Paquete vinculada (promocionId).
 *
 * REGLA DE VERSIONADO: editar una membresía NO altera las ya vendidas — al vender,
 * la composición vigente se copia como SNAPSHOT al PaquetePaciente; las ediciones
 * solo aplican a ventas futuras.
 */
import { Router } from 'express';
import { z } from 'zod';
import { addMonths, format } from 'date-fns';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { auditEnTx } from '../services/audit';

const router = Router();
const requireGestor = requireRol('admin', 'coordinadora_sedes');

const itemSchema = z.object({
  servicioId: z.string().uuid(),
  cantidad: z.number().int().min(1).max(50),
  // Subcategoría FIJADA en el constructor (opcional). Si se deja vacía y el servicio tiene
  // subcategorías activas, se elige al VENDER. Si se fija aquí, la venta la respeta.
  subcategoriaId: z.string().uuid().nullable().optional(),
});

const membresiaBodySchema = z.object({
  nombre: z.string().trim().min(2).max(160),
  descripcion: z.string().trim().max(500).optional(),
  duracionMeses: z.number().int().min(1).max(36),
  precio: z.number().nonnegative().nullable().optional(),
  sedesHabilitadas: z.array(z.string().uuid()).optional(), // vacío/undefined = todas
  composicion: z.array(itemSchema).min(1),
});

// Composición con etiquetas resueltas del catálogo (snapshot legible). Incluye la
// subcategoría FIJADA en el constructor (si se eligió) validándola contra el servicio.
async function composicionConEtiquetas(items: z.infer<typeof itemSchema>[]) {
  const servicios = await prisma.servicio.findMany({
    where: { id: { in: items.map((i) => i.servicioId) }, deletedAt: null },
    select: { id: true, nombre: true },
  });
  if (servicios.length !== new Set(items.map((i) => i.servicioId)).size) {
    throw new AppError('Algún servicio de la composición no existe', 400, 'SERVICIO_INVALIDO');
  }
  const nombrePor = new Map(servicios.map((s) => [s.id, s.nombre]));
  const subIds = items.map((i) => i.subcategoriaId).filter((x): x is string => !!x);
  const subs = subIds.length
    ? await prisma.subcategoriaServicio.findMany({ where: { id: { in: subIds }, deletedAt: null }, select: { id: true, nombre: true, servicioId: true } })
    : [];
  const subPor = new Map(subs.map((s) => [s.id, s]));
  return items.map((i) => {
    const base = { servicioId: i.servicioId, cantidad: i.cantidad, etiqueta: nombrePor.get(i.servicioId)! };
    if (!i.subcategoriaId) return base;
    const sub = subPor.get(i.subcategoriaId);
    if (!sub || sub.servicioId !== i.servicioId) throw new AppError('La subcategoría no corresponde al servicio', 400, 'SUBCATEGORIA_INVALIDA');
    return { ...base, subcategoriaId: sub.id, subcategoriaEtiqueta: sub.nombre };
  });
}

async function plantillaDe(promocionId: string) {
  const plantilla = await prisma.paquete.findFirst({ where: { promocionId, deletedAt: null } });
  if (!plantilla) throw new AppError('Membresía sin plantilla de sesiones', 500, 'MEMBRESIA_CORRUPTA');
  return plantilla;
}

// ─── GET /membresias — lista para el constructor (incl. inactivas) ───────────
router.get('/', requireAuth, requireGestor, async (_req, res) => {
  const promos = await prisma.promocion.findMany({
    where: { tipo: 'MEMBRESIA', deletedAt: null },
    orderBy: { nombre: 'asc' },
    include: { paquetesPlantilla: { where: { deletedAt: null }, take: 1 } },
  });
  const ventas = await prisma.paquetePaciente.groupBy({
    by: ['promocionId'],
    where: { promocionId: { in: promos.map((p) => p.id) }, deletedAt: null },
    _count: { _all: true },
  });
  const ventasPor = new Map(ventas.map((v) => [v.promocionId, v._count._all]));
  res.json(promos.map((p) => {
    const pl = p.paquetesPlantilla[0];
    return {
      id: p.id,
      nombre: p.nombre,
      descripcion: p.descripcion,
      precio: p.valor,
      activo: p.activo,
      duracionMeses: pl?.duracionMeses ?? null,
      sedesHabilitadas: pl?.sedesHabilitadas ?? null,
      composicion: pl?.composicion ?? [],
      totalSesiones: pl?.totalSesiones ?? 0,
      ventas: ventasPor.get(p.id) ?? 0,
    };
  }));
});

// ─── POST /membresias — crear ────────────────────────────────────────────────
router.post('/', requireAuth, requireGestor, async (req, res) => {
  const data = membresiaBodySchema.parse(req.body);
  const composicion = await composicionConEtiquetas(data.composicion);
  const total = composicion.reduce((s, i) => s + i.cantidad, 0);

  const creada = await prisma.$transaction(async (tx) => {
    const promo = await tx.promocion.create({
      data: { nombre: data.nombre, descripcion: data.descripcion, tipo: 'MEMBRESIA', valor: data.precio ?? null },
    });
    const plantilla = await tx.paquete.create({
      data: {
        nombre: data.nombre,
        servicioId: composicion[0].servicioId, // componente principal (columna legacy NOT NULL)
        totalSesiones: total,
        tipo: 'MEMBRESIA',
        composicion,
        duracionMeses: data.duracionMeses,
        sedesHabilitadas: data.sedesHabilitadas ?? undefined,
        promocionId: promo.id,
        precio: data.precio ?? null,
      },
    });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId,
      accion: 'crear_membresia',
      entidad: 'promocion',
      entidadId: promo.id,
      despues: { nombre: data.nombre, duracionMeses: data.duracionMeses, composicion, plantillaId: plantilla.id },
      ip: req.ip,
    });
    return promo;
  });
  res.status(201).json({ id: creada.id });
});

// ─── PATCH /membresias/:id — editar (NO toca las vendidas: snapshot) ─────────
router.patch('/:id', requireAuth, requireGestor, async (req, res) => {
  const data = membresiaBodySchema.partial().parse(req.body);
  const promo = await prisma.promocion.findFirst({ where: { id: req.params.id, tipo: 'MEMBRESIA', deletedAt: null } });
  if (!promo) throw new AppError('Membresía no encontrada', 404);
  const plantilla = await plantillaDe(promo.id);
  const composicion = data.composicion ? await composicionConEtiquetas(data.composicion) : undefined;

  await prisma.$transaction(async (tx) => {
    await tx.promocion.update({
      where: { id: promo.id },
      data: {
        nombre: data.nombre,
        descripcion: data.descripcion,
        ...(data.precio !== undefined ? { valor: data.precio } : {}),
      },
    });
    await tx.paquete.update({
      where: { id: plantilla.id },
      data: {
        nombre: data.nombre,
        duracionMeses: data.duracionMeses,
        ...(data.sedesHabilitadas !== undefined ? { sedesHabilitadas: data.sedesHabilitadas } : {}),
        ...(composicion ? { composicion, totalSesiones: composicion.reduce((s, i) => s + i.cantidad, 0), servicioId: composicion[0].servicioId } : {}),
        ...(data.precio !== undefined ? { precio: data.precio } : {}),
      },
    });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId,
      accion: 'editar_membresia',
      entidad: 'promocion',
      entidadId: promo.id,
      antes: { nombre: promo.nombre, composicion: plantilla.composicion, duracionMeses: plantilla.duracionMeses },
      despues: { ...data, composicion },
      ip: req.ip,
    });
  });
  res.json({ ok: true });
});

// ─── DELETE /membresias/:id — desactivar (soft; lo vendido sigue vivo) ──────
router.delete('/:id', requireAuth, requireGestor, async (req, res) => {
  const promo = await prisma.promocion.findFirst({ where: { id: req.params.id, tipo: 'MEMBRESIA', deletedAt: null } });
  if (!promo) throw new AppError('Membresía no encontrada', 404);
  const plantilla = await plantillaDe(promo.id);
  await prisma.$transaction(async (tx) => {
    await tx.promocion.update({ where: { id: promo.id }, data: { activo: false } });
    await tx.paquete.update({ where: { id: plantilla.id }, data: { activo: false } });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId,
      accion: 'desactivar_membresia',
      entidad: 'promocion',
      entidadId: promo.id,
      antes: { activo: true },
      despues: { activo: false },
      ip: req.ip,
    });
  });
  res.json({ ok: true });
});

// ─── GET /membresias/vendibles — membresías ACTIVAS para agendar/activar (recepción) ──
// Abierto a cualquier usuario autenticado (recepción activa membresías desde la agenda).
// Devuelve solo las activas con su composición vigente (plantilla) para el flujo del drawer.
router.get('/vendibles', requireAuth, async (_req, res) => {
  const promos = await prisma.promocion.findMany({
    where: { tipo: 'MEMBRESIA', activo: true, deletedAt: null },
    orderBy: { nombre: 'asc' },
    include: { paquetesPlantilla: { where: { deletedAt: null }, take: 1 } },
  });
  res.json(promos.map((p) => {
    const pl = p.paquetesPlantilla[0];
    return {
      id: p.id,
      nombre: p.nombre,
      activo: p.activo,
      duracionMeses: pl?.duracionMeses ?? null,
      sedesHabilitadas: (pl?.sedesHabilitadas as string[] | null) ?? null,
      composicion: pl?.composicion ?? [],
    };
  }));
});

// ─── POST /membresias/:id/activar — reactivar una membresía desactivada ──────
// Espejo del DELETE. Vuelve a poner activo=true en la promoción y su plantilla, para
// no tener que recrearla (evita el choque con el índice único de nombre).
router.post('/:id/activar', requireAuth, requireGestor, async (req, res) => {
  const promo = await prisma.promocion.findFirst({ where: { id: req.params.id, tipo: 'MEMBRESIA', deletedAt: null } });
  if (!promo) throw new AppError('Membresía no encontrada', 404);
  const plantilla = await plantillaDe(promo.id);
  await prisma.$transaction(async (tx) => {
    await tx.promocion.update({ where: { id: promo.id }, data: { activo: true } });
    await tx.paquete.update({ where: { id: plantilla.id }, data: { activo: true } });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId,
      accion: 'activar_membresia',
      entidad: 'promocion',
      entidadId: promo.id,
      antes: { activo: false },
      despues: { activo: true },
      ip: req.ip,
    });
  });
  res.json({ ok: true });
});

// ─── POST /membresias/:id/vender — venta a un paciente (SNAPSHOT) ────────────
// La subcategoría (ej. Profilaxis → Regular/Premium/…) se FIJA al vender: por cada
// ítem cuyo servicio tenga subcategorías activas hay que indicar cuál, y queda
// grabada en el snapshot de composición para el consumo.
const venderSchema = z.object({
  pacienteId: z.string().uuid(),
  sedeId: z.string().uuid(), // donde se vende = donde se atiende (candado de sede)
  fechaVenta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // inicio de vigencia
  fechaFin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),   // fin de vigencia (editable; si no, se calcula por duración)
  subcategorias: z.array(z.object({ servicioId: z.string().uuid(), subcategoriaId: z.string().uuid() })).optional(),
});

interface ItemSnapshot { servicioId: string; cantidad: number; etiqueta: string; subcategoriaId?: string; subcategoriaEtiqueta?: string }

router.post('/:id/vender', requireAuth, async (req, res) => {
  const data = venderSchema.parse(req.body);
  const promo = await prisma.promocion.findFirst({ where: { id: req.params.id, tipo: 'MEMBRESIA', activo: true, deletedAt: null } });
  if (!promo) throw new AppError('Membresía no encontrada o inactiva', 404);
  const plantilla = await plantillaDe(promo.id);

  const sedes = plantilla.sedesHabilitadas as string[] | null;
  if (sedes && sedes.length > 0 && !sedes.includes(data.sedeId)) {
    throw new AppError('Esta membresía no se vende en la sede indicada', 400, 'SEDE_NO_HABILITADA');
  }
  const paciente = await prisma.paciente.findFirst({ where: { id: data.pacienteId, deletedAt: null } });
  if (!paciente) throw new AppError('Paciente no encontrado', 404);

  const inicio = data.fechaVenta ?? format(new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' })), 'yyyy-MM-dd');
  // Fin de vigencia: el que se indique (fechas abiertas) o, por defecto, inicio + duración.
  const fin = data.fechaFin ?? format(addMonths(new Date(inicio + 'T12:00:00'), plantilla.duracionMeses ?? 12), 'yyyy-MM-dd');
  if (fin <= inicio) throw new AppError('La fecha de fin debe ser posterior a la de inicio', 400, 'RANGO_INVALIDO');
  const composicionBase = plantilla.composicion as unknown as ItemSnapshot[];

  // Fija la subcategoría de cada ítem que la requiera (snapshot de composición). Si el ítem YA
  // trae una subcategoría fijada en el constructor, se respeta; si no, y el servicio tiene
  // subcategorías activas, se toma la elegida en la venta (obligatoria).
  const elegidaPorServicio = new Map((data.subcategorias ?? []).map((s) => [s.servicioId, s.subcategoriaId]));
  const subsActivas = await prisma.subcategoriaServicio.findMany({
    where: { servicioId: { in: composicionBase.map((i) => i.servicioId) }, deletedAt: null, activo: true },
    select: { id: true, servicioId: true, nombre: true },
  });
  const composicion: ItemSnapshot[] = composicionBase.map((item) => {
    if (item.subcategoriaId) return item; // ya fijada en el constructor
    const opciones = subsActivas.filter((s) => s.servicioId === item.servicioId);
    if (opciones.length === 0) return item; // servicio sin subcategorías
    const elegida = elegidaPorServicio.get(item.servicioId);
    const match = opciones.find((o) => o.id === elegida);
    if (!match) throw new AppError(`Elige la subcategoría de "${item.etiqueta}"`, 400, 'SUBCATEGORIA_REQUERIDA');
    return { ...item, subcategoriaId: match.id, subcategoriaEtiqueta: match.nombre };
  });

  const pp = await prisma.$transaction(async (tx) => {
    const creado = await tx.paquetePaciente.create({
      data: {
        pacienteId: data.pacienteId,
        paqueteId: plantilla.id,
        fechaCompra: new Date(inicio + 'T12:00:00Z'),
        sesionesTotal: plantilla.totalSesiones,
        sedeId: data.sedeId,
        servicioNuevoId: composicion[0]?.servicioId ?? plantilla.servicioId,
        tipo: 'MEMBRESIA',
        composicion: composicion as never, // SNAPSHOT: la edición posterior del constructor no toca esta venta
        vigenciaInicio: inicio,
        vigenciaFin: fin,
        origen: 'AGENDA',
        promocionId: promo.id,
        estado: 'ACTIVO',
      },
    });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId,
      accion: 'vender_membresia',
      entidad: 'paquete_paciente',
      entidadId: creado.id,
      despues: { membresia: promo.nombre, pacienteId: data.pacienteId, sedeId: data.sedeId, vigencia: `${inicio} → ${fin}`, composicion },
      ip: req.ip,
    });
    return creado;
  });
  res.status(201).json(pp);
});

export default router;
