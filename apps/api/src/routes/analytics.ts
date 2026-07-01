import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { agregarRango, agregarHoy } from '../services/agregacion';

const router = Router();

const rangoSchema = z.object({
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sedeId: z.string().uuid().optional(),
  unidadNegocioId: z.string().uuid().optional(),
  profesionalId: z.string().uuid().optional(),
  servicioId: z.string().uuid().optional(),
});

function parseFecha(s: string) {
  return new Date(s + 'T12:00:00');
}

function parseFechaStart(s: string) {
  return new Date(s + 'T00:00:00');
}

function parseFechaEnd(s: string) {
  return new Date(s + 'T23:59:59');
}

function makeWhere(params: z.infer<typeof rangoSchema>) {
  return {
    fecha: { gte: parseFecha(params.desde), lte: parseFecha(params.hasta) },
    ...(params.sedeId ? { sedeId: params.sedeId } : {}),
    ...(params.unidadNegocioId ? { unidadNegocioId: params.unidadNegocioId } : {}),
    ...(params.profesionalId ? { profesionalId: params.profesionalId } : {}),
    ...(params.servicioId ? { servicioId: params.servicioId } : {}),
  };
}

function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function diffDays(desde: string, hasta: string) {
  return Math.round((parseFecha(hasta).getTime() - parseFecha(desde).getTime()) / 86400000) + 1;
}

function prevPeriod(desde: string, hasta: string) {
  const days = diffDays(desde, hasta);
  const hd = parseFecha(desde);
  const newHasta = addDays(hd, -1);
  const newDesde = addDays(newHasta, -(days - 1));
  return {
    desde: newDesde.toISOString().slice(0, 10),
    hasta: newHasta.toISOString().slice(0, 10),
  };
}

const requireCoordinadora = requireRol('admin', 'coordinadora_sedes');

// ─── Recalcular agregados ──────────────────────────────────────────────────────
router.post('/recalcular', requireAuth, requireCoordinadora, async (req, res) => {
  const { desde, hasta } = z.object({
    desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).parse(req.body);
  const n = await agregarRango(parseFechaStart(desde), parseFechaEnd(hasta));
  res.json({ ok: true, grupos: n });
});

router.post('/recalcular/hoy', requireAuth, requireCoordinadora, async (_req, res) => {
  const n = await agregarHoy();
  res.json({ ok: true, grupos: n });
});

// ─── KPIs globales ────────────────────────────────────────────────────────────
router.get('/kpis', requireAuth, requireCoordinadora, async (req, res) => {
  const params = rangoSchema.parse(req.query);
  const prev = prevPeriod(params.desde, params.hasta);

  const [curr, prevData] = await Promise.all([
    prisma.agregadoDiario.aggregate({
      where: makeWhere(params),
      _sum: {
        totalCitas: true, completadas: true, noShow: true, canceladas: true,
        llegaron: true, agendadas: true, confirmadas: true, enAtencion: true,
        minutosAtendidos: true, citasElegidasPorPaciente: true, citasAsignadasAuto: true,
      },
    }),
    prisma.agregadoDiario.aggregate({
      where: makeWhere({ ...params, desde: prev.desde, hasta: prev.hasta }),
      _sum: {
        totalCitas: true, completadas: true, noShow: true, canceladas: true,
        llegaron: true, minutosAtendidos: true,
      },
    }),
  ]);

  const s = curr._sum;
  const p = prevData._sum;

  const total = s.totalCitas ?? 0;
  const completadas = s.completadas ?? 0;
  const noShow = s.noShow ?? 0;
  const canceladas = s.canceladas ?? 0;
  const llegaron = s.llegaron ?? 0;
  const minutosAtendidos = s.minutosAtendidos ?? 0;
  const propios = s.citasElegidasPorPaciente ?? 0;

  const prevTotal = p.totalCitas ?? 0;
  const prevCompletadas = p.completadas ?? 0;
  const prevNoShow = p.noShow ?? 0;

  res.json({
    periodo: { desde: params.desde, hasta: params.hasta },
    totalCitas: total,
    completadas,
    noShow,
    canceladas,
    llegaron,
    minutosAtendidos,
    horasAtendidas: Math.round(minutosAtendidos / 60 * 10) / 10,
    tasaCompletadas: total > 0 ? Math.round(completadas / total * 1000) / 10 : 0,
    tasaNoShow: total > 0 ? Math.round(noShow / total * 1000) / 10 : 0,
    tasaCanceladas: total > 0 ? Math.round(canceladas / total * 1000) / 10 : 0,
    tasaPropios: total > 0 ? Math.round(propios / total * 1000) / 10 : 0,
    variacionTotal: prevTotal > 0 ? Math.round((total - prevTotal) / prevTotal * 1000) / 10 : null,
    variacionCompletadas: prevCompletadas > 0 ? Math.round((completadas - prevCompletadas) / prevCompletadas * 1000) / 10 : null,
    variacionNoShow: prevNoShow > 0 ? Math.round((noShow - prevNoShow) / prevNoShow * 1000) / 10 : null,
    prevPeriodo: { desde: prev.desde, hasta: prev.hasta },
  });
});

// ─── Ranking de profesionales ──────────────────────────────────────────────────
router.get('/profesionales', requireAuth, requireCoordinadora, async (req, res) => {
  const params = rangoSchema.parse(req.query);
  const where = makeWhere(params);

  const rows = await prisma.agregadoDiario.groupBy({
    by: ['profesionalId'],
    where: { ...where, profesionalId: { not: null } },
    _sum: {
      totalCitas: true, completadas: true, noShow: true, canceladas: true,
      minutosAtendidos: true, citasElegidasPorPaciente: true,
    },
    orderBy: { _sum: { completadas: 'desc' } },
  });

  const profIds = rows.map(r => r.profesionalId!);
  const profs = await prisma.profesional.findMany({
    where: { id: { in: profIds } },
    select: { id: true, nombres: true, apellidos: true, colorAvatar: true },
  });
  const profMap = new Map(profs.map(p => [p.id, p]));

  res.json(rows.map(r => {
    const p = profMap.get(r.profesionalId!);
    const total = r._sum.totalCitas ?? 0;
    const completadas = r._sum.completadas ?? 0;
    const noShow = r._sum.noShow ?? 0;
    const propios = r._sum.citasElegidasPorPaciente ?? 0;
    return {
      profesionalId: r.profesionalId,
      nombres: p?.nombres ?? '—',
      apellidos: p?.apellidos ?? '',
      colorAvatar: p?.colorAvatar ?? '#6B7F9E',
      totalCitas: total,
      completadas,
      noShow,
      canceladas: r._sum.canceladas ?? 0,
      minutosAtendidos: r._sum.minutosAtendidos ?? 0,
      tasaCompletadas: total > 0 ? Math.round(completadas / total * 1000) / 10 : 0,
      tasaNoShow: total > 0 ? Math.round(noShow / total * 1000) / 10 : 0,
      tasaPropios: total > 0 ? Math.round(propios / total * 1000) / 10 : 0,
    };
  }));
});

// ─── Ranking de servicios ──────────────────────────────────────────────────────
router.get('/servicios', requireAuth, requireCoordinadora, async (req, res) => {
  const params = rangoSchema.parse(req.query);
  const where = makeWhere(params);

  const rows = await prisma.agregadoDiario.groupBy({
    by: ['servicioId'],
    where,
    _sum: { totalCitas: true, completadas: true, noShow: true, minutosAtendidos: true },
    orderBy: { _sum: { totalCitas: 'desc' } },
  });

  const servIds = rows.map(r => r.servicioId);
  const servs = await prisma.servicio.findMany({
    where: { id: { in: servIds } },
    select: { id: true, nombre: true, color: true, unidadNegocio: { select: { id: true, nombre: true } } },
  });
  const servMap = new Map(servs.map(s => [s.id, s]));

  res.json(rows.map(r => {
    const s = servMap.get(r.servicioId);
    const total = r._sum.totalCitas ?? 0;
    return {
      servicioId: r.servicioId,
      nombre: s?.nombre ?? '—',
      color: s?.color ?? '#6B7F9E',
      unidadNegocio: s?.unidadNegocio?.nombre ?? '—',
      totalCitas: total,
      completadas: r._sum.completadas ?? 0,
      noShow: r._sum.noShow ?? 0,
      minutosAtendidos: r._sum.minutosAtendidos ?? 0,
      tasaCompletadas: total > 0 ? Math.round((r._sum.completadas ?? 0) / total * 1000) / 10 : 0,
    };
  }));
});

// ─── Comparativa por sede ──────────────────────────────────────────────────────
router.get('/sedes', requireAuth, requireCoordinadora, async (req, res) => {
  const params = rangoSchema.parse(req.query);
  const where = makeWhere(params);

  const rows = await prisma.agregadoDiario.groupBy({
    by: ['sedeId'],
    where,
    _sum: {
      totalCitas: true, completadas: true, noShow: true, canceladas: true,
      minutosAtendidos: true, citasElegidasPorPaciente: true,
    },
    orderBy: { _sum: { totalCitas: 'desc' } },
  });

  const sedeIds = rows.map(r => r.sedeId);
  const sedes = await prisma.sede.findMany({
    where: { id: { in: sedeIds } },
    select: { id: true, nombre: true, color: true },
  });
  const sedeMap = new Map(sedes.map(s => [s.id, s]));

  res.json(rows.map(r => {
    const s = sedeMap.get(r.sedeId);
    const total = r._sum.totalCitas ?? 0;
    const completadas = r._sum.completadas ?? 0;
    const noShow = r._sum.noShow ?? 0;
    const propios = r._sum.citasElegidasPorPaciente ?? 0;
    return {
      sedeId: r.sedeId,
      nombre: s?.nombre ?? '—',
      color: s?.color ?? '#6B7F9E',
      totalCitas: total,
      completadas,
      noShow,
      canceladas: r._sum.canceladas ?? 0,
      minutosAtendidos: r._sum.minutosAtendidos ?? 0,
      tasaCompletadas: total > 0 ? Math.round(completadas / total * 1000) / 10 : 0,
      tasaNoShow: total > 0 ? Math.round(noShow / total * 1000) / 10 : 0,
      tasaPropios: total > 0 ? Math.round(propios / total * 1000) / 10 : 0,
    };
  }));
});

// ─── Heatmap día × hora ────────────────────────────────────────────────────────
router.get('/heatmap', requireAuth, requireCoordinadora, async (req, res) => {
  const params = rangoSchema.parse(req.query);

  // Query citas directly for granularity
  const citas = await prisma.cita.findMany({
    where: {
      fecha: { gte: parseFechaStart(params.desde), lte: parseFechaEnd(params.hasta) },
      deletedAt: null,
      ...(params.sedeId ? { sedeId: params.sedeId } : {}),
      ...(params.unidadNegocioId ? { unidadNegocioId: params.unidadNegocioId } : {}),
      ...(params.profesionalId ? { profesionalId: params.profesionalId } : {}),
    },
    select: { fecha: true, horaInicio: true, estado: true, slotRol: true },
  });

  // dia 0=Dom…6=Sab, hora 8..19
  type Cell = { total: number; completadas: number };
  const grid: Record<string, Cell> = {};

  for (const c of citas) {
    if (c.estado === 'cancelada' || c.estado === 'reprogramada') continue;
    // Bloque combinado: la mitad SECUNDARIA comparte la misma hora física que el ancla.
    // El heatmap mide demanda física → el bloque cuenta como UNA hora (se omite el extra).
    if (c.slotRol === 'SECUNDARIO') continue;
    const dia = c.fecha.getDay();
    const hora = parseInt(c.horaInicio.slice(0, 2), 10);
    if (hora < 8 || hora > 19) continue;
    const key = `${dia}:${hora}`;
    if (!grid[key]) grid[key] = { total: 0, completadas: 0 };
    grid[key].total++;
    if (c.estado === 'completada') grid[key].completadas++;
  }

  const result: { dia: number; hora: number; total: number; completadas: number }[] = [];
  for (let dia = 0; dia <= 6; dia++) {
    for (let hora = 8; hora <= 19; hora++) {
      const cell = grid[`${dia}:${hora}`] ?? { total: 0, completadas: 0 };
      result.push({ dia, hora, ...cell });
    }
  }

  res.json(result);
});

// ─── Unidades de negocio disponibles ─────────────────────────────────────────
router.get('/unidades', requireAuth, requireCoordinadora, async (_req, res) => {
  const rows = await prisma.unidadNegocio.findMany({
    select: { id: true, nombre: true, color: true },
    orderBy: { nombre: 'asc' },
  });
  res.json(rows);
});

// ─── Canal de reserva (de dónde viene el cliente) ─────────────────────────────
// Va directo sobre `citas` (AgregadoDiario no tiene la dimensión canal).
router.get('/canales', requireAuth, requireCoordinadora, async (req, res) => {
  const params = rangoSchema.parse(req.query);
  const where = {
    fecha: { gte: parseFechaStart(params.desde), lte: parseFechaEnd(params.hasta) },
    deletedAt: null,
    ...(params.sedeId ? { sedeId: params.sedeId } : {}),
    ...(params.unidadNegocioId ? { unidadNegocioId: params.unidadNegocioId } : {}),
  };
  const rows = await prisma.cita.groupBy({
    by: ['canal'],
    where,
    _count: { _all: true },
  });
  const completadas = await prisma.cita.groupBy({
    by: ['canal'],
    where: { ...where, estado: 'completada' },
    _count: { _all: true },
  });
  const compMap = new Map(completadas.map(c => [c.canal, c._count._all]));
  const total = rows.reduce((s, r) => s + r._count._all, 0);

  res.json(rows
    .map(r => ({
      canal: r.canal,
      totalCitas: r._count._all,
      completadas: compMap.get(r.canal) ?? 0,
      porcentaje: total > 0 ? Math.round((r._count._all / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.totalCitas - a.totalCitas));
});

// ─── Promociones (comportamiento de cada promo según la agenda) ───────────────
// Va directo sobre `citas`. NO requiere deduplicación de bloques combinados: `promocionId`
// vive SOLO en la cita portadora (PRINCIPAL/profilaxis), así que cada bloque cuenta 1 vez.
router.get('/promociones', requireAuth, requireCoordinadora, async (req, res) => {
  const params = rangoSchema.parse(req.query);
  const where = {
    fecha: { gte: parseFechaStart(params.desde), lte: parseFechaEnd(params.hasta) },
    deletedAt: null,
    promocionId: { not: null },
    ...(params.sedeId ? { sedeId: params.sedeId } : {}),
    ...(params.unidadNegocioId ? { unidadNegocioId: params.unidadNegocioId } : {}),
  };
  const rows = await prisma.cita.groupBy({ by: ['promocionId'], where, _count: { _all: true } });
  const completadas = await prisma.cita.groupBy({ by: ['promocionId'], where: { ...where, estado: 'completada' }, _count: { _all: true } });
  const compMap = new Map(completadas.map(c => [c.promocionId, c._count._all]));

  // Resolver nombre/tipo/valor de cada promo usada.
  const ids = rows.map(r => r.promocionId).filter((x): x is string => !!x);
  const promos = await prisma.promocion.findMany({ where: { id: { in: ids } }, select: { id: true, nombre: true, tipo: true, valor: true } });
  const promoMap = new Map(promos.map(p => [p.id, p]));

  res.json(rows
    .map(r => {
      const p = promoMap.get(r.promocionId!);
      const usos = r._count._all;
      const comp = compMap.get(r.promocionId) ?? 0;
      return {
        promocionId: r.promocionId,
        nombre: p?.nombre ?? '—',
        tipo: p?.tipo ?? 'OTRO',
        valor: p?.valor ?? null,
        totalCitas: usos,
        completadas: comp,
        // % completadas SOBRE EL TOTAL DE ESA PROMO (no sobre el global).
        porcentajeCompletadas: usos > 0 ? Math.round((comp / usos) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.totalCitas - a.totalCitas));
});

// ─── Tendencia (línea de tiempo) ──────────────────────────────────────────────
router.get('/tendencia', requireAuth, requireCoordinadora, async (req, res) => {
  const params = rangoSchema.parse(req.query);
  const granularidadParam = z.enum(['auto', 'dia', 'semana', 'mes']).optional().parse(req.query.granularidad);
  const days = diffDays(params.desde, params.hasta);

  // Auto-granularity: ≤31d → daily, ≤93d → weekly, else monthly
  const granularidad = granularidadParam && granularidadParam !== 'auto'
    ? granularidadParam
    : (days <= 31 ? 'dia' : days <= 93 ? 'semana' : 'mes');

  const rows = await prisma.agregadoDiario.groupBy({
    by: ['fecha'],
    where: makeWhere(params),
    _sum: { totalCitas: true, completadas: true, noShow: true, canceladas: true },
    orderBy: { fecha: 'asc' },
  });

  if (granularidad === 'dia') {
    return res.json({
      granularidad,
      puntos: rows.map(r => ({
        fecha: r.fecha.toISOString().slice(0, 10),
        totalCitas: r._sum.totalCitas ?? 0,
        completadas: r._sum.completadas ?? 0,
        noShow: r._sum.noShow ?? 0,
        canceladas: r._sum.canceladas ?? 0,
      })),
    });
  }

  // Aggregate by week or month
  const buckets = new Map<string, { totalCitas: number; completadas: number; noShow: number; canceladas: number }>();

  for (const r of rows) {
    let key: string;
    const d = r.fecha;
    if (granularidad === 'semana') {
      // ISO week: Monday
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((day + 6) % 7));
      key = monday.toISOString().slice(0, 10);
    } else {
      key = d.toISOString().slice(0, 7); // YYYY-MM
    }
    const b = buckets.get(key) ?? { totalCitas: 0, completadas: 0, noShow: 0, canceladas: 0 };
    b.totalCitas += r._sum.totalCitas ?? 0;
    b.completadas += r._sum.completadas ?? 0;
    b.noShow += r._sum.noShow ?? 0;
    b.canceladas += r._sum.canceladas ?? 0;
    buckets.set(key, b);
  }

  res.json({
    granularidad,
    puntos: Array.from(buckets.entries()).map(([fecha, v]) => ({ fecha, ...v })),
  });
});

// ─── No-shows y cancelaciones ─────────────────────────────────────────────────
router.get('/noshow', requireAuth, requireCoordinadora, async (req, res) => {
  const params = rangoSchema.parse(req.query);

  const [porProfesional, porSede] = await Promise.all([
    prisma.agregadoDiario.groupBy({
      by: ['profesionalId'],
      where: { ...makeWhere(params), profesionalId: { not: null } },
      _sum: { totalCitas: true, noShow: true, canceladas: true },
      orderBy: { _sum: { noShow: 'desc' } },
      take: 10,
    }),
    prisma.agregadoDiario.groupBy({
      by: ['sedeId'],
      where: makeWhere(params),
      _sum: { totalCitas: true, noShow: true, canceladas: true },
      orderBy: { _sum: { noShow: 'desc' } },
    }),
  ]);

  const profIds = porProfesional.map(r => r.profesionalId!);
  const sedeIds = porSede.map(r => r.sedeId);

  const [profs, sedes] = await Promise.all([
    prisma.profesional.findMany({ where: { id: { in: profIds } }, select: { id: true, nombres: true, apellidos: true } }),
    prisma.sede.findMany({ where: { id: { in: sedeIds } }, select: { id: true, nombre: true, color: true } }),
  ]);

  const profMap = new Map(profs.map(p => [p.id, p]));
  const sedeMap = new Map(sedes.map(s => [s.id, s]));

  res.json({
    porProfesional: porProfesional.map(r => {
      const p = profMap.get(r.profesionalId!);
      const total = r._sum.totalCitas ?? 0;
      const noShow = r._sum.noShow ?? 0;
      return {
        profesionalId: r.profesionalId,
        nombres: p?.nombres ?? '—',
        apellidos: p?.apellidos ?? '',
        total, noShow, canceladas: r._sum.canceladas ?? 0,
        tasaNoShow: total > 0 ? Math.round(noShow / total * 1000) / 10 : 0,
      };
    }),
    porSede: porSede.map(r => {
      const s = sedeMap.get(r.sedeId);
      const total = r._sum.totalCitas ?? 0;
      const noShow = r._sum.noShow ?? 0;
      return {
        sedeId: r.sedeId,
        nombre: s?.nombre ?? '—',
        color: s?.color ?? '#6B7F9E',
        total, noShow, canceladas: r._sum.canceladas ?? 0,
        tasaNoShow: total > 0 ? Math.round(noShow / total * 1000) / 10 : 0,
      };
    }),
  });
});

// ─── Caseload propio (elegida_por_paciente) ───────────────────────────────────
router.get('/caseload', requireAuth, requireCoordinadora, async (req, res) => {
  const params = rangoSchema.parse(req.query);

  const rows = await prisma.agregadoDiario.groupBy({
    by: ['profesionalId'],
    where: { ...makeWhere(params), profesionalId: { not: null } },
    _sum: { totalCitas: true, citasElegidasPorPaciente: true, citasAsignadasAuto: true },
    orderBy: { _sum: { citasElegidasPorPaciente: 'desc' } },
  });

  const profIds = rows.map(r => r.profesionalId!);
  const profs = await prisma.profesional.findMany({
    where: { id: { in: profIds } },
    select: { id: true, nombres: true, apellidos: true, colorAvatar: true },
  });
  const profMap = new Map(profs.map(p => [p.id, p]));

  res.json(rows.map(r => {
    const p = profMap.get(r.profesionalId!);
    const total = r._sum.totalCitas ?? 0;
    const propios = r._sum.citasElegidasPorPaciente ?? 0;
    return {
      profesionalId: r.profesionalId,
      nombres: p?.nombres ?? '—',
      apellidos: p?.apellidos ?? '',
      colorAvatar: p?.colorAvatar ?? '#6B7F9E',
      totalCitas: total,
      propios,
      asignados: r._sum.citasAsignadasAuto ?? 0,
      pctPropios: total > 0 ? Math.round(propios / total * 1000) / 10 : 0,
    };
  }));
});

export default router;
