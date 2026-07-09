/**
 * Pantalla de Conciliación de aperturas Genexis (solo ADMIN).
 * El motor propone; aquí un humano firma: Aprobar / Editar-y-aprobar / Descartar.
 * Nada de esta pantalla edita saldos después de aprobar: correcciones = consumos
 * AJUSTE_MANUAL trazables.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { aprobarApertura } from '../services/aperturaService';

const router = Router();
const requireAdmin = requireRol('admin');

// El JWT no lleva el nombre: se resuelve fresco (la firma humana queda con nombre legible).
async function nombreUsuario(userId: string | undefined): Promise<string> {
  if (!userId) return 'admin';
  const u = await prisma.usuario.findUnique({ where: { id: userId }, select: { nombre: true } });
  return u?.nombre ?? 'admin';
}

// ─── GET /conciliacion/pendientes-paciente/:id — pista para RECEPCIÓN ─────────
// Consulta liviana (cualquier usuario autenticado): ¿este paciente tiene saldos
// Genexis aún SIN conciliar? El drawer de Nueva Cita lo usa para explicar por qué
// un paquete que se ve en el visor Genexis todavía no aparece en la Agenda.
router.get('/pendientes-paciente/:pacienteId', requireAuth, async (req, res) => {
  const pendientes = await prisma.conciliacionApertura.findMany({
    where: { pacienteId: req.params.pacienteId, estado: 'PENDIENTE', deletedAt: null },
    select: { confianza: true, familia: { select: { nombreFamilia: true, tipo: true } } },
  });
  res.json({
    total: pendientes.length,
    familias: pendientes.map((p) => ({ familia: p.familia.nombreFamilia, tipo: p.familia.tipo, confianza: p.confianza })),
  });
});

// ─── GET /conciliacion/aperturas — tabla maestra + contadores ────────────────
const listarQuery = z.object({
  estado: z.enum(['PENDIENTE', 'APROBADA', 'EDITADA', 'DESCARTADA']).optional(),
  confianza: z.enum(['VERDE', 'AMBAR', 'ROJO']).optional(),
  familiaId: z.string().uuid().optional(),
  sedeId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

router.get('/aperturas', requireAuth, requireAdmin, async (req, res) => {
  const q = listarQuery.parse(req.query);
  const where = {
    deletedAt: null,
    ...(q.estado ? { estado: q.estado } : {}),
    ...(q.confianza ? { confianza: q.confianza } : {}),
    ...(q.familiaId ? { familiaId: q.familiaId } : {}),
    ...(q.sedeId ? { OR: [{ sedeAprobadaId: q.sedeId }, { sedeAprobadaId: null, sedeInferidaId: q.sedeId }] } : {}),
  };
  const [filas, total, porEstado, porConfianza, familias, sedes, servicios] = await Promise.all([
    prisma.conciliacionApertura.findMany({
      where,
      include: {
        paciente: { select: { id: true, nombres: true, apellidoPaterno: true, apellidoMaterno: true, tipoDocumento: true, numeroDocumento: true } },
        familia: { select: { id: true, nombreFamilia: true, tipo: true, sesionesTotales: true, duracionMeses: true } },
      },
      orderBy: [{ confianza: 'asc' }, { creadoEn: 'asc' }],
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.conciliacionApertura.count({ where }),
    prisma.conciliacionApertura.groupBy({ by: ['estado'], where: { deletedAt: null }, _count: { _all: true } }),
    prisma.conciliacionApertura.groupBy({ by: ['confianza'], where: { deletedAt: null, estado: 'PENDIENTE' }, _count: { _all: true } }),
    prisma.familiaPaqueteGenexis.findMany({ where: { deletedAt: null }, select: { id: true, nombreFamilia: true, tipo: true } , orderBy: { nombreFamilia: 'asc' } }),
    prisma.sede.findMany({ where: { deletedAt: null }, select: { id: true, nombre: true, color: true } }),
    prisma.servicio.findMany({ where: { deletedAt: null }, select: { id: true, nombre: true, codigo: true } }),
  ]);
  res.json({
    data: filas,
    page: q.page,
    limit: q.limit,
    total,
    contadores: {
      porEstado: Object.fromEntries(porEstado.map((e) => [e.estado, e._count._all])),
      pendientesPorConfianza: Object.fromEntries(porConfianza.map((c) => [c.confianza, c._count._all])),
    },
    catalogos: { familias, sedes, servicios },
  });
});

// ─── GET /conciliacion/aperturas/:id/evidencia — citas-evidencia del historial ──
router.get('/aperturas/:id/evidencia', requireAuth, requireAdmin, async (req, res) => {
  const c = await prisma.conciliacionApertura.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!c) throw new AppError('Propuesta no encontrada', 404);
  const ids = (c.evidenciaIds as string[]) ?? [];
  const registros = await prisma.historialGenexis.findMany({
    where: { id: { in: ids }, deletedAt: null },
    orderBy: [{ fechaCita: 'desc' }, { horaCita: 'desc' }],
  });
  res.json({ data: registros, lecturaServicio: c.lecturaServicio, lecturaObs: c.lecturaObs });
});

// ─── POST /conciliacion/aperturas/:id/aprobar — firma (con ediciones opcionales) ──
const aprobarBody = z.object({
  consumo: z.number().int().min(0).optional(),
  sedeId: z.string().uuid().optional(),
  vigenciaFin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notas: z.string().trim().max(500).optional(),
});

router.post('/aperturas/:id/aprobar', requireAuth, requireAdmin, async (req, res) => {
  const body = aprobarBody.parse(req.body);
  const pp = await aprobarApertura({
    conciliacionId: req.params.id,
    usuarioId: req.user?.userId,
    usuarioNombre: await nombreUsuario(req.user?.userId),
    ...body,
  });
  res.status(201).json(pp);
});

// ─── POST /conciliacion/aperturas/aprobar-bloque — aprobación en bloque ──────
// Aprueba en lote las PENDIENTES de una confianza. VERDE = casos claros; AMBAR =
// acepta la propuesta pro-cliente (máx−1) tal cual. ROJO NUNCA en bloque (ilegibles,
// requieren ojo). Las que fallan (sin sede, sin vigencia, etc.) se reportan y quedan
// PENDIENTES para revisión manual — nunca se aprueban a medias.
router.post('/aperturas/aprobar-bloque', requireAuth, requireAdmin, async (req, res) => {
  const parsed = z
    .object({ confianza: z.enum(['VERDE', 'AMBAR']), familiaId: z.string().uuid().optional() })
    .parse(req.body);
  const candidatas = await prisma.conciliacionApertura.findMany({
    where: { deletedAt: null, estado: 'PENDIENTE', confianza: parsed.confianza, ...(parsed.familiaId ? { familiaId: parsed.familiaId } : {}) },
    select: { id: true },
  });
  let aprobadas = 0;
  const nombre = await nombreUsuario(req.user?.userId);
  const errores: { id: string; error: string }[] = [];
  for (const c of candidatas) {
    try {
      await aprobarApertura({ conciliacionId: c.id, usuarioId: req.user?.userId, usuarioNombre: nombre });
      aprobadas += 1;
    } catch (e) {
      errores.push({ id: c.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  // Resumen de motivos de fallo (para explicar cuántas quedaron sin sede, etc.).
  const motivos: Record<string, number> = {};
  for (const e of errores) motivos[e.error] = (motivos[e.error] ?? 0) + 1;
  await prisma.auditLog.create({
    data: {
      usuarioId: req.user?.userId,
      accion: 'aprobar_bloque_conciliacion',
      entidad: 'conciliacion_apertura',
      entidadId: '00000000-0000-0000-0000-000000000000',
      despues: { confianza: parsed.confianza, aprobadas, fallidas: errores.length, motivos } as never,
    },
  });
  res.json({ aprobadas, fallidas: errores.length, motivos });
});

// ─── POST /conciliacion/aperturas/:id/descartar ───────────────────────────────
router.post('/aperturas/:id/descartar', requireAuth, requireAdmin, async (req, res) => {
  const motivo = z.object({ motivo: z.string().trim().min(3).max(500) }).parse(req.body).motivo;
  const c = await prisma.conciliacionApertura.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!c) throw new AppError('Propuesta no encontrada', 404);
  if (c.estado !== 'PENDIENTE') throw new AppError('La propuesta ya fue decidida', 409, 'YA_DECIDIDA');
  await prisma.$transaction(async (tx) => {
    await tx.conciliacionApertura.update({
      where: { id: c.id },
      data: { estado: 'DESCARTADA', notas: motivo, decididoPor: await nombreUsuario(req.user?.userId), decididoEn: new Date() },
    });
    await tx.auditLog.create({
      data: {
        usuarioId: req.user?.userId,
        accion: 'descartar_apertura_genexis',
        entidad: 'conciliacion_apertura',
        entidadId: c.id,
        despues: { motivo } as never,
      },
    });
  });
  res.json({ ok: true });
});

// ─── POST /conciliacion/cerrar — cierre formal del proceso ───────────────────
router.post('/cerrar', requireAuth, requireAdmin, async (req, res) => {
  const confirmarPendientes = req.body?.confirmarPendientes === true;
  const pendientes = await prisma.conciliacionApertura.count({ where: { deletedAt: null, estado: 'PENDIENTE' } });
  if (pendientes > 0 && !confirmarPendientes) {
    throw new AppError(`Quedan ${pendientes} propuestas pendientes — confirma explícitamente para cerrar con pendientes`, 409, 'PENDIENTES_ABIERTAS');
  }
  const porEstado = await prisma.conciliacionApertura.groupBy({ by: ['estado'], where: { deletedAt: null }, _count: { _all: true } });
  await prisma.auditLog.create({
    data: {
      usuarioId: req.user?.userId,
      accion: 'cerrar_conciliacion_genexis',
      entidad: 'conciliacion_apertura',
      entidadId: '00000000-0000-0000-0000-000000000000',
      despues: { selladoPor: await nombreUsuario(req.user?.userId), pendientesAlCierre: pendientes, porEstado: Object.fromEntries(porEstado.map((e) => [e.estado, e._count._all])) } as never,
    },
  });
  res.json({ ok: true, pendientesAlCierre: pendientes });
});

export default router;
