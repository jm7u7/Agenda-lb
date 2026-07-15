import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { redis } from '../redis';
import { requireAuth, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
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

// ─── Recalcular agregados (con candado anti-concurrencia) ──────────────────────
// El ETL de agregados_diarios tarda ~2 min a volumen real; dos ejecuciones concurrentes se
// pisarían sobre la misma tabla. Candado GLOBAL en Redis (cubre AMBOS endpoints de recálculo,
// porque ambos escriben agregados_diarios): SET NX + TTL como candado; si ya hay uno en curso
// se responde 409 (no se encola, no se espera). El TTL cubre el caso de proceso muerto que no
// alcanzó a liberar. Se libera en `finally` SOLO si seguimos siendo el dueño del candado
// (script Lua compare-and-delete) para no borrar un candado ajeno re-tomado tras expirar.
const RECALC_LOCK_KEY = 'analytics:recalcular:lock';
const RECALC_LOCK_TTL_S = 600; // 10 min
const LUA_UNLOCK = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

async function conLockRecalculo<T>(
  meta: { usuarioId?: string; ip?: string; accion: string; detalle: Record<string, unknown> },
  run: () => Promise<T>,
): Promise<T> {
  const token = randomUUID();
  let tengoLock = false;
  let redisVivo = true;
  try {
    tengoLock = (await redis.set(RECALC_LOCK_KEY, token, 'EX', RECALC_LOCK_TTL_S, 'NX')) === 'OK';
  } catch (e) {
    // Redis caído: no bloqueamos el recálculo por una caída de caché (coherente con el resto
    // del proyecto), pero queda sin protección de concurrencia mientras Redis no esté.
    redisVivo = false;
    console.warn('[analytics] Redis no disponible para el candado de recálculo; se ejecuta sin lock', e);
  }
  if (redisVivo && !tengoLock) {
    throw new AppError('Ya hay un recálculo de agregados en ejecución. Espera a que termine.', 409, 'RECALCULO_EN_CURSO');
  }
  try {
    const resultado = await run();
    // Auditoría: quién disparó el recálculo y su alcance/resultado (best-effort).
    try {
      await prisma.auditLog.create({
        data: {
          usuarioId: meta.usuarioId,
          accion: meta.accion,
          entidad: 'analytics',
          entidadId: '00000000-0000-0000-0000-000000000000',
          ip: meta.ip,
          despues: { ...meta.detalle, resultado } as never,
        },
      });
    } catch (e) {
      console.warn('[analytics] no se pudo registrar AuditLog del recálculo', e);
    }
    return resultado;
  } finally {
    if (tengoLock) {
      try {
        await redis.eval(LUA_UNLOCK, 1, RECALC_LOCK_KEY, token);
      } catch { /* no crítico: el TTL liberará el candado */ }
    }
  }
}

// PROPUESTA (no implementada — pendiente de aprobación): job programado de madrugada vía BullMQ
// `repeatable` (p. ej. cron diario 03:00 America/Lima) que dispare el recálculo automáticamente,
// para que agregados_diarios no dependa de disparos manuales. Reutilizaría este mismo candado
// (`analytics:recalcular:lock`) para no colisionar con un recálculo manual en curso.

router.post('/recalcular', requireAuth, requireCoordinadora, async (req, res) => {
  const { desde, hasta } = z.object({
    desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).parse(req.body);
  const n = await conLockRecalculo(
    { usuarioId: req.user?.userId, ip: req.ip, accion: 'recalcular_agregados', detalle: { desde, hasta } },
    () => agregarRango(parseFechaStart(desde), parseFechaEnd(hasta)),
  );
  res.json({ ok: true, grupos: n });
});

router.post('/recalcular/hoy', requireAuth, requireCoordinadora, async (req, res) => {
  const n = await conLockRecalculo(
    { usuarioId: req.user?.userId, ip: req.ip, accion: 'recalcular_agregados_hoy', detalle: { alcance: 'hoy' } },
    () => agregarHoy(),
  );
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

  // Agregación en SQL: agrupamos por (día de semana civil × hora) directamente en Postgres
  // en vez de traer las ~280k citas del rango a Node. `EXTRACT(DOW FROM fecha)` (0=Dom…6=Sáb)
  // usa el día CIVIL almacenado en la columna @db.Date — correcto e independiente de la zona
  // horaria del proceso (`fecha.getDay()` restaba 5h en America/Lima y desfasaba un día).
  // La hora sale de "horaInicio" ("HH:mm" local Lima). Se excluyen cancelada/reprogramada y
  // las mitades SECUNDARIO de bloques combinados (el heatmap mide demanda física = 1 hora).
  //
  // ⚠️ CAMBIO DE COMPORTAMIENTO (2026-07-11): esta corrección MUEVE cada total al día de la
  // semana correcto. Respecto a versiones anteriores los conteos aparecen "corridos" una
  // columna (el bug UTC−5 los atribuía al día previo). NO es una regresión: es el fix del
  // día de semana. Ver memory `gate0-analytics-perf`.
  const filtros: Prisma.Sql[] = [
    Prisma.sql`"deletedAt" IS NULL`,
    Prisma.sql`fecha >= ${params.desde}::date AND fecha <= ${params.hasta}::date`,
    Prisma.sql`estado::text NOT IN ('cancelada', 'reprogramada')`,
    Prisma.sql`("slotRol" IS NULL OR "slotRol"::text <> 'SECUNDARIO')`,
  ];
  if (params.sedeId) filtros.push(Prisma.sql`"sedeId" = ${params.sedeId}::uuid`);
  if (params.unidadNegocioId) filtros.push(Prisma.sql`"unidadNegocioId" = ${params.unidadNegocioId}::uuid`);
  if (params.profesionalId) filtros.push(Prisma.sql`"profesionalId" = ${params.profesionalId}::uuid`);

  // dia 0=Dom…6=Sab, hora 8..19 — Postgres devuelve solo las celdas con datos (≤ 84 filas).
  const rows = await prisma.$queryRaw<{ dia: number; hora: number; total: number; completadas: number }[]>(Prisma.sql`
    SELECT EXTRACT(DOW FROM fecha)::int AS dia,
           LEFT("horaInicio", 2)::int   AS hora,
           COUNT(*)::int                AS total,
           COUNT(*) FILTER (WHERE estado::text = 'completada')::int AS completadas
    FROM citas
    WHERE ${Prisma.join(filtros, ' AND ')}
      AND LEFT("horaInicio", 2)::int BETWEEN 8 AND 19
    GROUP BY 1, 2
  `);

  const grid = new Map(rows.map((r) => [`${r.dia}:${r.hora}`, r]));
  const result: { dia: number; hora: number; total: number; completadas: number }[] = [];
  for (let dia = 0; dia <= 6; dia++) {
    for (let hora = 8; hora <= 19; hora++) {
      const cell = grid.get(`${dia}:${hora}`);
      result.push({ dia, hora, total: cell?.total ?? 0, completadas: cell?.completadas ?? 0 });
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

// ─── Pacientes nuevos (captación) ──────────────────────────────────────────────
// "Paciente nuevo" = paciente cuya PRIMERA visita cae en el período. La primera visita es
// la mínima fecha entre (a) su historial Genexis y (b) sus citas reales. NO se usa creadoEn
// porque todos los migrados se crearon el mismo día (05/07). Devuelve total + comparación al
// período anterior + serie mensual + reparto por sede de la primera visita.
router.get('/pacientes-nuevos', requireAuth, requireCoordinadora, async (req, res) => {
  const params = rangoSchema.parse(req.query);
  const prev = prevPeriod(params.desde, params.hasta);

  // El historial guarda la sede como TEXTO; si se filtra por sede, resolvemos su nombre.
  let sedeNombre: string | null = null;
  if (params.sedeId) {
    const s = await prisma.sede.findUnique({ where: { id: params.sedeId }, select: { nombre: true } });
    sedeNombre = s?.nombre ?? '__sin_match__';
  }
  const sedeFilter = sedeNombre ? Prisma.sql`AND primera.sede = ${sedeNombre}` : Prisma.empty;

  // CTE compartida: primera visita (fecha mínima) por paciente, con la sede de esa visita.
  const cte = Prisma.sql`
    WITH visitas AS (
      SELECT h."pacienteId" AS pid, h."fechaCita" AS f, COALESCE(NULLIF(h.sede,''), '(sin sede)') AS sede
        FROM historial_genexis h
        WHERE h."pacienteId" IS NOT NULL AND h."fechaCita" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      UNION ALL
      SELECT c."pacienteId" AS pid, to_char(c.fecha, 'YYYY-MM-DD') AS f, s.nombre AS sede
        FROM citas c JOIN sedes s ON s.id = c."sedeId"
        WHERE c."deletedAt" IS NULL AND c.estado NOT IN ('cancelada', 'reprogramada', 'no_show')
    ),
    primera AS (
      SELECT DISTINCT ON (pid) pid, f AS primera_fecha, sede
        FROM visitas ORDER BY pid, f ASC
    )`;

  // Serie mensual + totales del período actual y del anterior en una sola pasada.
  const meses = await prisma.$queryRaw<{ mes: string; curr: number; prev: number }[]>(Prisma.sql`
    ${cte}
    SELECT substring(primera.primera_fecha, 1, 7) AS mes,
      SUM(CASE WHEN primera.primera_fecha >= ${params.desde} AND primera.primera_fecha <= ${params.hasta} THEN 1 ELSE 0 END)::int AS curr,
      SUM(CASE WHEN primera.primera_fecha >= ${prev.desde} AND primera.primera_fecha <= ${prev.hasta} THEN 1 ELSE 0 END)::int AS prev
    FROM primera
    WHERE primera.primera_fecha >= ${prev.desde} AND primera.primera_fecha <= ${params.hasta} ${sedeFilter}
    GROUP BY 1 ORDER BY 1
  `);

  const porSede = await prisma.$queryRaw<{ sede: string; n: number }[]>(Prisma.sql`
    ${cte}
    SELECT primera.sede AS sede, COUNT(*)::int AS n
    FROM primera
    WHERE primera.primera_fecha >= ${params.desde} AND primera.primera_fecha <= ${params.hasta} ${sedeFilter}
    GROUP BY 1 ORDER BY 2 DESC LIMIT 12
  `);

  const total = meses.reduce((s, m) => s + m.curr, 0);
  const prevTotal = meses.reduce((s, m) => s + m.prev, 0);

  res.json({
    periodo: { desde: params.desde, hasta: params.hasta },
    prevPeriodo: { desde: prev.desde, hasta: prev.hasta },
    total,
    prevTotal,
    variacion: prevTotal > 0 ? Math.round((total - prevTotal) / prevTotal * 1000) / 10 : null,
    puntos: meses.filter(m => m.curr > 0).map(m => ({ mes: m.mes, nuevos: m.curr })),
    porSede: porSede.map(s => ({ sede: s.sede, nuevos: s.n })),
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
