/**
 * Desempeño de Agentes — endpoints bajo /api/v1/analytics/agentes.
 * Solo lectura. Gate: permiso `analytics.agentes` (admin + coordinadora_sedes por defecto).
 * Agregaciones pesadas cacheadas en Redis (TTL corto) con clave por filtros.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { redis } from '../redis';
import { requireAuth, requirePermiso } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import {
  resumenDesempeno, reporteRecitacion, diaLima,
  SCORE_CONFIG, type FiltrosDesempeno,
} from '../services/agentPerformanceService';

const router = Router();
router.use(requireAuth, requirePermiso('analytics.agentes'));

const filtrosSchema = z.object({
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sedeId: z.string().uuid().optional(),
  area: z.enum(['CONTACT_CENTER', 'RECEPCION', 'OTRO']).optional(),
  servicioId: z.string().uuid().optional(),
  canal: z.string().optional(),
});

// ─── Caché Redis (TTL corto, clave por filtros; si Redis falla se calcula igual) ─
const CACHE_TTL_S = 600; // 10 min

async function cacheado<T>(clave: string, fn: () => Promise<T>): Promise<T> {
  const key = `agperf:v1:${clave}`;
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch { /* Redis caído → computar directo */ }
  const valor = await fn();
  try {
    await redis.setex(key, CACHE_TTL_S, JSON.stringify(valor));
  } catch { /* no crítico */ }
  return valor;
}

const claveFiltros = (f: FiltrosDesempeno) =>
  [f.desde, f.hasta, f.sedeId ?? '-', f.area ?? '-', f.servicioId ?? '-', f.canal ?? '-'].join(':');

// ─── GET /lista — agentes clasificados (para selectores) ──────────────────────
router.get('/lista', async (_req, res) => {
  const agentes = await prisma.usuario.findMany({
    where: { deletedAt: null, activo: true, area: { not: null } },
    select: {
      id: true, nombre: true, area: true,
      sedeAsignada: { select: { id: true, nombre: true, color: true } },
    },
    orderBy: [{ area: 'asc' }, { nombre: 'asc' }],
  });
  res.json(agentes);
});

// ─── GET /config — pesos y umbrales del score (para mostrar en la UI) ─────────
router.get('/config', (_req, res) => {
  res.json(SCORE_CONFIG);
});

// ─── GET /resumen — tabla de agentes + totales + tendencia ────────────────────
router.get('/resumen', async (req, res) => {
  const filtros = filtrosSchema.parse(req.query);
  const data = await cacheado(`resumen:${claveFiltros(filtros)}`, () => resumenDesempeno(filtros));
  res.json(data);
});

// ─── GET /comparativa?ids=a,b,c — tarjetas comparativas (hasta 8) ─────────────
router.get('/comparativa', async (req, res) => {
  const filtros = filtrosSchema.parse(req.query);
  const ids = String(req.query.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) throw new AppError('Indica al menos un agente en ?ids=', 400, 'SIN_AGENTES');
  if (ids.length > 8) throw new AppError('Máximo 8 agentes en la comparativa', 400, 'DEMASIADOS_AGENTES');

  // Mismo cálculo cacheado del resumen (percentiles = del EQUIPO completo, no del subgrupo).
  const resumen = await cacheado(`resumen:${claveFiltros(filtros)}`, () => resumenDesempeno(filtros));
  const porId = new Map(resumen.agentes.map((a) => [a.agenteId, a]));
  const seleccionados = ids.map((id) => porId.get(id)).filter((a) => a !== undefined);
  if (seleccionados.length === 0) throw new AppError('Ningún agente válido en la selección', 404, 'AGENTES_NO_ENCONTRADOS');

  res.json({
    filtros,
    umbralShowRateCritico: SCORE_CONFIG.umbralShowRateCritico,
    agentes: seleccionados,
  });
});

// ─── GET /recitacion — reporte por sede / recepcionista ────────────────────────
router.get('/recitacion', async (req, res) => {
  const filtros = filtrosSchema.parse(req.query);
  const data = await cacheado(`recitacion:${claveFiltros(filtros)}`, () => reporteRecitacion(filtros));
  res.json(data);
});

// ─── GET /agente/:id — drill-down (KPIs + series + desgloses) ─────────────────
router.get('/agente/:id', async (req, res) => {
  const filtros = filtrosSchema.parse(req.query);
  const agenteId = z.string().uuid().parse(req.params.id);

  const data = await cacheado(`agente:${agenteId}:${claveFiltros(filtros)}`, async () => {
    const resumen = await resumenDesempeno(filtros, true);
    const agente = resumen.agentes.find((a) => a.agenteId === agenteId);
    if (!agente) return null;

    // Desglose por sede y servicio de las citas propias del rango (día civil de creación).
    const desdeUtc = new Date(new Date(`${filtros.desde}T00:00:00Z`).getTime() + 5 * 3_600_000);
    const hastaUtc = new Date(new Date(`${filtros.hasta}T00:00:00Z`).getTime() + 29 * 3_600_000);
    const whereCitas = {
      deletedAt: null,
      creadoPorUsuarioId: agenteId,
      creadoEn: { gte: desdeUtc, lt: hastaUtc },
      ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}),
      ...(filtros.servicioId ? { servicioId: filtros.servicioId } : {}),
      ...(filtros.canal ? { canal: filtros.canal } : {}),
    };
    const [porSede, porServicio] = await Promise.all([
      prisma.cita.groupBy({ by: ['sedeId'], where: whereCitas, _count: { _all: true } }),
      prisma.cita.groupBy({ by: ['servicioId'], where: whereCitas, _count: { _all: true } }),
    ]);
    const [sedes, servicios] = await Promise.all([
      prisma.sede.findMany({ where: { id: { in: porSede.map((r) => r.sedeId) } }, select: { id: true, nombre: true, color: true } }),
      prisma.servicio.findMany({ where: { id: { in: porServicio.map((r) => r.servicioId) } }, select: { id: true, nombre: true, color: true } }),
    ]);
    const sedeMap = new Map(sedes.map((s) => [s.id, s]));
    const servMap = new Map(servicios.map((s) => [s.id, s]));

    return {
      filtros,
      agente,
      totalesEquipo: resumen.totales,
      porSede: porSede
        .map((r) => ({ sede: sedeMap.get(r.sedeId) ?? { id: r.sedeId, nombre: '—', color: '#6B7F9E' }, citas: r._count._all }))
        .sort((a, b) => b.citas - a.citas),
      porServicio: porServicio
        .map((r) => ({ servicio: servMap.get(r.servicioId) ?? { id: r.servicioId, nombre: '—', color: '#6B7F9E' }, citas: r._count._all }))
        .sort((a, b) => b.citas - a.citas),
    };
  });

  if (!data) throw new AppError('Agente no encontrado o sin área asignada', 404);
  res.json(data);
});

// ─── GET /agente/:id/citas — lista paginada de citas propias (sin caché) ──────
router.get('/agente/:id/citas', async (req, res) => {
  const filtros = filtrosSchema.parse(req.query);
  const agenteId = z.string().uuid().parse(req.params.id);
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(5, Number(req.query.pageSize) || 20));

  const desdeUtc = new Date(new Date(`${filtros.desde}T00:00:00Z`).getTime() + 5 * 3_600_000);
  const hastaUtc = new Date(new Date(`${filtros.hasta}T00:00:00Z`).getTime() + 29 * 3_600_000);
  const where = {
    deletedAt: null,
    creadoPorUsuarioId: agenteId,
    creadoEn: { gte: desdeUtc, lt: hastaUtc },
    ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}),
    ...(filtros.servicioId ? { servicioId: filtros.servicioId } : {}),
    ...(filtros.canal ? { canal: filtros.canal } : {}),
  };

  const [total, citas] = await Promise.all([
    prisma.cita.count({ where }),
    prisma.cita.findMany({
      where,
      select: {
        id: true, fecha: true, horaInicio: true, estado: true, canal: true,
        slotGrupoId: true, slotRol: true, creadoEn: true,
        paciente: { select: { nombres: true, apellidoPaterno: true } },
        sede: { select: { nombre: true, color: true } },
        servicio: { select: { nombre: true, color: true } },
        promocion: { select: { nombre: true } },
      },
      orderBy: { creadoEn: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  res.json({
    page, pageSize, total, totalPages: Math.ceil(total / pageSize),
    citas: citas.map((c) => ({ ...c, creadoDia: diaLima(c.creadoEn) })),
  });
});

// ─── GET /timeline/:agenteId — eventos del AuditLog (read-only, paginado) ──────
router.get('/timeline/:agenteId', async (req, res) => {
  const agenteId = z.string().uuid().parse(req.params.agenteId);
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 30));

  const where = { usuarioId: agenteId, entidad: 'cita' };
  const [total, eventos] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      select: { id: true, accion: true, citaId: true, antes: true, despues: true, sedeId: true, creadoEn: true },
      orderBy: { creadoEn: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  res.json({ page, pageSize, total, totalPages: Math.ceil(total / pageSize), eventos });
});

export default router;
