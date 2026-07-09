/**
 * Reportes RRHH — dos reportes derivados de la operación de la agenda, sin tocar nada:
 *
 *  1. HORAS EXTRA (`GET /reportes/horas-extra`): todo lo trabajado FUERA del horario
 *     regular. Base (decisión del cliente): el DELTA contra el horario normal de la sede.
 *      · Día con `ExcepcionHorario` abierta que EXTIENDE el cierre → cuentan las horas más
 *        allá del cierre normal (y antes de la apertura normal).
 *      · Día normalmente CERRADO (domingo/feriado) abierto por excepción → TODA la jornada
 *        es extra.
 *     Sobre las horas crudas se calcula el equivalente con recargo peruano (D.L. 854 / D.L.
 *     713): jornada laborable +25% las 2 primeras horas y +35% desde la 3ª; descanso
 *     semanal/feriado +100% (hora pagada al doble). Es referencia para RRHH — la planilla
 *     aplica el sueldo real.
 *
 *  2. ROTACIÓN INTERSEDES (`GET /reportes/rotacion`): en qué sede estuvo cada podóloga cada
 *     día del mes (sede base vs préstamos de un día a otra sede), con total de días de
 *     presencia y cumplimiento de una META de días configurable (bonos de RRHH).
 *
 * Solo lectura. Rol admin / coordinadora_sedes.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { timeToMinutes } from '@limablue/shared';
import { turnosDelDia } from '../services/disponibilidad';
import { auditEnTx } from '../services/audit';

const router = Router();
const requireGestor = requireRol('admin', 'coordinadora_sedes');

// ── Helpers de fecha (UTC, fechas civiles YYYY-MM-DD) ────────────────────────
const YMD = /^\d{4}-\d{2}-\d{2}$/;
function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function diaUTC(s: string): Date { return new Date(s + 'T00:00:00.000Z'); }
/** Días [desde, hasta] inclusive, con su día de semana (0=Dom..6=Sáb). */
function rangoDias(desde: string, hasta: string): { fecha: string; date: Date; weekday: number }[] {
  const out: { fecha: string; date: Date; weekday: number }[] = [];
  const fin = diaUTC(hasta).getTime();
  for (let t = diaUTC(desde); t.getTime() <= fin; t = new Date(t.getTime() + 86400000)) {
    out.push({ fecha: ymd(t), date: new Date(t), weekday: t.getUTCDay() });
  }
  return out;
}
/** Solapamiento en minutos de [aIni,aFin] con [bIni,bFin] (todos en minutos). */
function solapeMin(aIni: number, aFin: number, bIni: number, bFin: number): number {
  return Math.max(0, Math.min(aFin, bFin) - Math.max(aIni, bIni));
}
const round2 = (n: number) => Math.round(n * 100) / 100;

// Ventana normal de una sede en un día de semana, desde el JSON Sede.horario.
type HorarioSede = Record<string, { apertura?: string; cierre?: string; abierto?: boolean }>;
function ventanaNormal(horario: unknown, weekday: number): { apertura: string; cierre: string } | null {
  const dia = (horario as HorarioSede | null | undefined)?.[String(weekday)];
  if (dia && dia.abierto && dia.apertura && dia.cierre) return { apertura: dia.apertura, cierre: dia.cierre };
  return null; // cerrada ese día (o sin config) → jornada completa es extra
}

const rangoSchema = z.object({
  desde: z.string().regex(YMD),
  hasta: z.string().regex(YMD),
  sedeId: z.string().uuid().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// REPORTE 1 — HORAS EXTRA
// ─────────────────────────────────────────────────────────────────────────────
router.get('/horas-extra', requireAuth, requireGestor, async (req, res) => {
  const { desde, hasta, sedeId } = rangoSchema.parse(req.query);
  if (desde > hasta) throw new AppError('Rango de fechas inválido', 400, 'RANGO_INVALIDO');

  // Días con excepción de sede ABIERTA en el rango (extensión de cierre o día cerrado abierto).
  const excepciones = await prisma.excepcionHorario.findMany({
    where: { fecha: { gte: diaUTC(desde), lte: diaUTC(hasta) }, abierto: true, ...(sedeId ? { sedeId } : {}) },
    include: { sede: { select: { id: true, nombre: true, color: true, horario: true } } },
    orderBy: { fecha: 'asc' },
  });

  // Almuerzos recurrentes de todos los profesionales (para descontar del tramo extra).
  const almuerzos = await prisma.bloqueoAgenda.findMany({
    where: { tipo: 'ALMUERZO', esRecurrente: true, deletedAt: null, horaInicio: { not: null }, horaFin: { not: null } },
    select: { profesionalId: true, horaInicio: true, horaFin: true },
  });
  const almuerzoPorProf = new Map<string, { ini: number; fin: number }[]>();
  for (const a of almuerzos) {
    if (!a.horaInicio || !a.horaFin) continue;
    const arr = almuerzoPorProf.get(a.profesionalId) ?? [];
    arr.push({ ini: timeToMinutes(a.horaInicio), fin: timeToMinutes(a.horaFin) });
    almuerzoPorProf.set(a.profesionalId, arr);
  }

  // Acumula por (profesional, día): minutos extra + categoría (recargo).
  interface DiaExtra { fecha: string; sede: string; sedeColor: string; extraMin: number; categoria: 'DESCANSO' | 'EXTENDIDO'; nota: string | null; entrada: string; salida: string; }
  const porProfDia = new Map<string, DiaExtra>(); // key `${profId}|${fecha}`
  const profIdsVistos = new Set<string>();

  for (const exc of excepciones) {
    const fecha = ymd(exc.fecha);
    const weekday = exc.fecha.getUTCDay();
    const normal = ventanaNormal(exc.sede.horario, weekday);
    const notaFeriado = /feriad|domingo|festiv/i.test(exc.nota ?? '');
    // Categoría de recargo: descanso semanal/feriado (+100%) si la sede normalmente cierra
    // ese día, o es domingo, o la nota lo marca; si no, es extensión de jornada (+25/35%).
    const categoria: 'DESCANSO' | 'EXTENDIDO' = (!normal || weekday === 0 || notaFeriado) ? 'DESCANSO' : 'EXTENDIDO';

    // Profesionales asignados a esa sede esa fecha (base + coberturas de un día).
    const asignados = await prisma.asignacionSede.findMany({
      where: { sedeId: exc.sedeId, activa: true, fechaInicio: { lte: exc.fecha }, OR: [{ fechaFin: null }, { fechaFin: { gte: exc.fecha } }] },
      select: { profesionalId: true },
      distinct: ['profesionalId'],
    });
    const profIds = asignados.map((a) => a.profesionalId);
    if (profIds.length === 0) continue;

    const turnos = await turnosDelDia(exc.sedeId, fecha, profIds);
    const normalIni = normal ? timeToMinutes(normal.apertura) : 0;
    const normalFin = normal ? timeToMinutes(normal.cierre) : 0;

    for (const [profId, turno] of turnos) {
      const tIni = timeToMinutes(turno.horaInicio);
      const tFin = timeToMinutes(turno.horaFin);
      // Tramos extra: día cerrado → toda la jornada; extensión → cola tras el cierre normal
      // y/o cabeza antes de la apertura normal.
      const tramos: [number, number][] = [];
      if (categoria === 'DESCANSO' || !normal) {
        tramos.push([tIni, tFin]);
      } else {
        if (tFin > normalFin) tramos.push([Math.max(tIni, normalFin), tFin]);
        if (tIni < normalIni) tramos.push([tIni, Math.min(tFin, normalIni)]);
      }
      const lunches = almuerzoPorProf.get(profId) ?? [];
      let extraMin = 0;
      for (const [ini, fin] of tramos) {
        let m = Math.max(0, fin - ini);
        for (const l of lunches) m -= solapeMin(ini, fin, l.ini, l.fin);
        extraMin += Math.max(0, m);
      }
      if (extraMin <= 0) continue;
      profIdsVistos.add(profId);
      const key = `${profId}|${fecha}`;
      const prev = porProfDia.get(key);
      if (prev) {
        prev.extraMin += extraMin;
        if (categoria === 'DESCANSO') prev.categoria = 'DESCANSO';
      } else {
        porProfDia.set(key, { fecha, sede: exc.sede.nombre, sedeColor: exc.sede.color, extraMin, categoria, nota: exc.nota, entrada: turno.horaInicio, salida: turno.horaFin });
      }
    }
  }

  // Datos de los profesionales vistos.
  const profs = await prisma.profesional.findMany({
    where: { id: { in: [...profIdsVistos] } },
    select: { id: true, nombres: true, apellidos: true, tipo: true, colorAvatar: true },
  });
  const profInfo = new Map(profs.map((p) => [p.id, p]));

  // Equivalente con recargo peruano, por día y por profesional.
  function equivalente(horas: number, categoria: 'DESCANSO' | 'EXTENDIDO'): number {
    if (categoria === 'DESCANSO') return horas * 2.0;              // +100%
    return Math.min(horas, 2) * 1.25 + Math.max(0, horas - 2) * 1.35; // +25% / +35%
  }

  const agg = new Map<string, {
    profesionalId: string; nombre: string; tipo: string; colorAvatar: string;
    horasExtra: number; horasEquivalentes: number; diasDescanso: number; diasExtendido: number;
    dias: { fecha: string; sede: string; sedeColor: string; horas: number; equivalente: number; categoria: string; entrada: string; salida: string; nota: string | null }[];
  }>();
  for (const [key, d] of porProfDia) {
    const profId = key.split('|')[0];
    const info = profInfo.get(profId);
    if (!info) continue;
    const horas = round2(d.extraMin / 60);
    const eq = round2(equivalente(horas, d.categoria));
    let a = agg.get(profId);
    if (!a) {
      a = { profesionalId: profId, nombre: `${info.nombres} ${info.apellidos}`, tipo: info.tipo, colorAvatar: info.colorAvatar, horasExtra: 0, horasEquivalentes: 0, diasDescanso: 0, diasExtendido: 0, dias: [] };
      agg.set(profId, a);
    }
    a.horasExtra = round2(a.horasExtra + horas);
    a.horasEquivalentes = round2(a.horasEquivalentes + eq);
    if (d.categoria === 'DESCANSO') a.diasDescanso += 1; else a.diasExtendido += 1;
    a.dias.push({ fecha: d.fecha, sede: d.sede, sedeColor: d.sedeColor, horas, equivalente: eq, categoria: d.categoria, entrada: d.entrada, salida: d.salida, nota: d.nota });
  }

  const filas = [...agg.values()].sort((x, y) => y.horasExtra - x.horasExtra);
  for (const f of filas) f.dias.sort((a, b) => a.fecha.localeCompare(b.fecha));
  res.json({
    desde, hasta,
    totalHorasExtra: round2(filas.reduce((s, f) => s + f.horasExtra, 0)),
    totalHorasEquivalentes: round2(filas.reduce((s, f) => s + f.horasEquivalentes, 0)),
    profesionales: filas,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REPORTE 2 — ROTACIÓN INTERSEDES
// ─────────────────────────────────────────────────────────────────────────────
const rotacionSchema = rangoSchema.extend({
  profesionalId: z.string().uuid().optional(),
  meta: z.coerce.number().int().min(0).max(31).optional(), // meta global de días (fallback)
});

function esCoberturaUnDia(a: { fechaInicio: Date; fechaFin: Date | null; motivo: string }): boolean {
  return a.motivo === 'COBERTURA_EMERGENCIA' && !!a.fechaFin && a.fechaInicio.getTime() === a.fechaFin.getTime();
}

router.get('/rotacion', requireAuth, requireGestor, async (req, res) => {
  const { desde, hasta, sedeId, profesionalId, meta } = rotacionSchema.parse(req.query);
  if (desde > hasta) throw new AppError('Rango de fechas inválido', 400, 'RANGO_INVALIDO');
  const dias = rangoDias(desde, hasta);
  const desdeD = diaUTC(desde), hastaD = diaUTC(hasta);

  // Podólogas objetivo.
  const podologas = await prisma.profesional.findMany({
    where: { tipo: 'podologa', deletedAt: null, ...(profesionalId ? { id: profesionalId } : {}) },
    select: { id: true, nombres: true, apellidos: true, colorAvatar: true, metaDiasMes: true },
    orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
  });
  const ids = podologas.map((p) => p.id);

  // Todas las asignaciones que tocan el rango, horarios base, entradas y sedes (una sola query c/u).
  const [asignaciones, horarios, entradas, sedes] = await Promise.all([
    prisma.asignacionSede.findMany({
      where: { profesionalId: { in: ids }, activa: true, fechaInicio: { lte: hastaD }, OR: [{ fechaFin: null }, { fechaFin: { gte: desdeD } }] },
      include: { sede: { select: { id: true, nombre: true, color: true, horario: true } } },
      orderBy: { fechaInicio: 'asc' },
    }),
    prisma.horarioProfesional.findMany({ where: { profesionalId: { in: ids }, activo: true }, select: { profesionalId: true, diaSemana: true } }),
    prisma.entradaPodologa.findMany({ where: { profesionalId: { in: ids }, fecha: { gte: desdeD, lte: hastaD } }, select: { profesionalId: true, fecha: true } }),
    prisma.sede.findMany({ where: { deletedAt: null }, select: { id: true, nombre: true, color: true, horario: true } }),
  ]);
  const sedeHorario = new Map(sedes.map((s) => [s.id, s.horario]));

  const asgPorProf = new Map<string, typeof asignaciones>();
  for (const a of asignaciones) { const arr = asgPorProf.get(a.profesionalId) ?? []; arr.push(a); asgPorProf.set(a.profesionalId, arr); }
  const diasHorario = new Map<string, Set<number>>();
  for (const h of horarios) { const s = diasHorario.get(h.profesionalId) ?? new Set(); s.add(h.diaSemana); diasHorario.set(h.profesionalId, s); }
  const entradaSet = new Set(entradas.map((e) => `${e.profesionalId}|${ymd(e.fecha)}`));

  const filas = podologas.map((p) => {
    const asgs = asgPorProf.get(p.id) ?? [];
    const bases = asgs.filter((a) => !esCoberturaUnDia(a));
    const coberturas = asgs.filter((a) => esCoberturaUnDia(a));
    const misDias = diasHorario.get(p.id) ?? new Set<number>();

    // Sede base "principal" del mes (la asignación base de mayor cobertura → para el filtro/columna).
    const baseSedeConteo = new Map<string, number>();

    const porSede = new Map<string, { sede: string; color: string; dias: number; prestamo: boolean }>();
    const timeline: { fecha: string; sede: string | null; color: string | null; prestamo: boolean; trabaja: boolean }[] = [];
    let totalDias = 0, diasPrestamo = 0;

    for (const { fecha, date, weekday } of dias) {
      const t = date.getTime();
      const cob = coberturas.find((a) => a.fechaInicio.getTime() <= t && (a.fechaFin ? a.fechaFin.getTime() : Infinity) >= t);
      const base = bases.find((a) => a.fechaInicio.getTime() <= t && (a.fechaFin ? a.fechaFin.getTime() : Infinity) >= t);
      if (base) baseSedeConteo.set(base.sedeId, (baseSedeConteo.get(base.sedeId) ?? 0) + 1);

      const asignada = cob?.sede ?? base?.sede ?? null;
      let trabaja = false;
      let prestamo = false;
      if (cob) { trabaja = true; prestamo = true; }
      else if (entradaSet.has(`${p.id}|${fecha}`)) { trabaja = true; } // presencia en día especial
      else if (base && misDias.has(weekday)) {
        const h = ventanaNormal(sedeHorario.get(base.sedeId), weekday);
        if (h) trabaja = true; // día laborable normal con la sede abierta
      }

      timeline.push({ fecha, sede: asignada?.nombre ?? null, color: asignada?.color ?? null, prestamo, trabaja });
      if (trabaja && asignada) {
        totalDias += 1;
        if (prestamo) diasPrestamo += 1;
        const k = asignada.id;
        const cur = porSede.get(k) ?? { sede: asignada.nombre, color: asignada.color, dias: 0, prestamo: false };
        cur.dias += 1;
        if (prestamo) cur.prestamo = true;
        porSede.set(k, cur);
      }
    }

    const sedeBaseId = [...baseSedeConteo.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const sedeBase = sedes.find((s) => s.id === sedeBaseId) ?? null;
    const diasBase = sedeBaseId ? (porSede.get(sedeBaseId)?.dias ?? 0) : 0;
    const metaEfectiva = p.metaDiasMes ?? meta ?? null;
    return {
      profesionalId: p.id,
      nombre: `${p.nombres} ${p.apellidos}`,
      colorAvatar: p.colorAvatar,
      sedeBaseId,
      sedeBase: sedeBase?.nombre ?? null,
      totalDias,
      diasBase,
      diasPrestamo,
      metaDiasMes: p.metaDiasMes ?? null,
      metaEfectiva,
      cumpleMeta: metaEfectiva != null ? totalDias >= metaEfectiva : null,
      pctCumplimiento: metaEfectiva ? Math.round((totalDias / metaEfectiva) * 100) : null,
      porSede: [...porSede.values()].sort((a, b) => b.dias - a.dias),
      timeline,
    };
  });

  // Filtro por sede: podólogas cuya sede BASE del mes es la elegida (la "columna" de esa sede).
  const filtradas = sedeId ? filas.filter((f) => f.sedeBaseId === sedeId) : filas;
  res.json({ desde, hasta, sedes: sedes.map((s) => ({ id: s.id, nombre: s.nombre, color: s.color })), profesionales: filtradas });
});

// ─── PATCH /reportes/meta/:profesionalId — fija la meta de días de una podóloga ──
router.patch('/meta/:profesionalId', requireAuth, requireGestor, async (req, res) => {
  const body = z.object({ metaDiasMes: z.number().int().min(0).max(31).nullable() }).parse(req.body);
  const prof = await prisma.profesional.findFirst({ where: { id: req.params.profesionalId, deletedAt: null }, select: { id: true, metaDiasMes: true } });
  if (!prof) throw new AppError('Profesional no encontrado', 404);
  await prisma.$transaction(async (tx) => {
    await tx.profesional.update({ where: { id: prof.id }, data: { metaDiasMes: body.metaDiasMes } });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId,
      accion: 'fijar_meta_dias',
      entidad: 'profesional',
      entidadId: prof.id,
      antes: { metaDiasMes: prof.metaDiasMes },
      despues: { metaDiasMes: body.metaDiasMes },
      ip: req.ip,
    });
  });
  res.json({ ok: true, metaDiasMes: body.metaDiasMes });
});

export default router;
