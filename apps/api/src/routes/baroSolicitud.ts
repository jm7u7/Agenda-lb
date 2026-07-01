import { Router } from 'express';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { registrarAudit } from '../services/audit';

const router = Router();

// Unidad de baropodometría + sus servicios (los 2 de evaluación).
async function baroContexto() {
  const unidad = await prisma.unidadNegocio.findFirst({
    where: { nombre: { startsWith: 'Baropodometr' }, deletedAt: null },
    select: { id: true, nombre: true },
  });
  if (!unidad) throw new AppError('No existe la unidad de Baropodometría', 404);
  const servicios = await prisma.servicio.findMany({
    where: { unidadNegocioId: unidad.id, deletedAt: null },
    select: { id: true, nombre: true },
  });
  return { unidad, servicios, servicioIds: servicios.map((s) => s.id) };
}

// ─── GET /baro-solicitud ─── lista por-solicitud + profesionales disponibles ───
router.get('/', requireAuth, async (_req, res) => {
  const { servicios, servicioIds } = await baroContexto();

  // Competencias "por solicitud" activas de baropodometría.
  const comps = await prisma.competenciaProfesional.findMany({
    where: { servicioId: { in: servicioIds }, activa: true, soloPorSolicitud: true },
    include: { profesional: { select: { id: true, nombres: true, apellidos: true, tipo: true, activo: true } } },
  });

  // Agrupar por profesional (cuántos de los 2 servicios cubre).
  const porProf = new Map<string, { id: string; nombre: string; tipo: string; activo: boolean; servicios: number }>();
  for (const c of comps) {
    const p = c.profesional;
    const e = porProf.get(p.id) ?? { id: p.id, nombre: `${p.nombres} ${p.apellidos}`, tipo: p.tipo, activo: p.activo, servicios: 0 };
    e.servicios++;
    porProf.set(p.id, e);
  }
  const porSolicitud = [...porProf.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  const yaEnLista = new Set(porSolicitud.map((p) => p.id));

  // Pool de AUTO-ASIGNACIÓN: profesionales con competencia baro NO-por-solicitud.
  // Son el mecanismo automático (slots "Baro N"): no deben ofrecerse para agregar.
  const auto = await prisma.competenciaProfesional.findMany({
    where: { servicioId: { in: servicioIds }, activa: true, soloPorSolicitud: false },
    select: { profesionalId: true },
  });
  const autoPool = new Set(auto.map((a) => a.profesionalId));

  // Profesionales activos que se pueden AGREGAR (ni en la lista, ni en el pool auto).
  const todos = await prisma.profesional.findMany({
    where: { activo: true, deletedAt: null },
    select: { id: true, nombres: true, apellidos: true, tipo: true },
    orderBy: [{ apellidos: 'asc' }],
  });
  // Excluye los placeholders internos de auto-asignación ("Baro 1", "Baro 2"…),
  // que no son doctores reales que agregar por nombre.
  const esSlotGenerico = (p: { nombres: string; apellidos: string }) =>
    /^baro\s*\d+$/i.test(`${p.nombres} ${p.apellidos}`.trim());

  const disponibles = todos
    .filter((p) => !yaEnLista.has(p.id) && !autoPool.has(p.id) && !esSlotGenerico(p))
    .map((p) => ({ id: p.id, nombre: `${p.nombres} ${p.apellidos}`, tipo: p.tipo }));

  res.json({ servicios, porSolicitud, disponibles });
});

// ─── POST /baro-solicitud/:profesionalId ─── agregar a la lista por solicitud ──
router.post('/:profesionalId', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const { servicioIds } = await baroContexto();
  const profesionalId = req.params.profesionalId;

  const prof = await prisma.profesional.findUnique({ where: { id: profesionalId, deletedAt: null }, select: { id: true } });
  if (!prof) throw new AppError('Profesional no encontrado', 404);

  // Upsert de la competencia "por solicitud" para AMBOS servicios de baro.
  for (const servicioId of servicioIds) {
    await prisma.competenciaProfesional.upsert({
      where: { profesionalId_servicioId: { profesionalId, servicioId } },
      update: { activa: true, soloPorSolicitud: true },
      create: { profesionalId, servicioId, habilitadoDesde: new Date(), activa: true, soloPorSolicitud: true },
    });
  }
  await registrarAudit({
    usuarioId: req.user?.userId, accion: 'baro_solicitud_agregar', entidad: 'profesional', entidadId: profesionalId,
    despues: { soloPorSolicitud: true, servicios: servicioIds.length }, ip: req.ip,
  });
  res.json({ ok: true });
});

// ─── DELETE /baro-solicitud/:profesionalId ─── quitar de la lista por solicitud ─
router.delete('/:profesionalId', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const { servicioIds } = await baroContexto();
  const profesionalId = req.params.profesionalId;

  // Desactiva SOLO las competencias por-solicitud (no toca los slots de auto-asignación).
  const r = await prisma.competenciaProfesional.updateMany({
    where: { profesionalId, servicioId: { in: servicioIds }, soloPorSolicitud: true },
    data: { activa: false },
  });
  await registrarAudit({
    usuarioId: req.user?.userId, accion: 'baro_solicitud_quitar', entidad: 'profesional', entidadId: profesionalId,
    despues: { competenciasDesactivadas: r.count }, ip: req.ip,
  });
  res.json({ ok: true, desactivadas: r.count });
});

export default router;
