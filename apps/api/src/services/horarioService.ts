/**
 * horarioService — PUNTO ÚNICO DE ESCRITURA de los horarios del personal.
 *
 * Capas del modelo (las lee el resolvedor único `turnosDelDia`):
 *   CAPA 0  ventana de la sede    → Sede.horario + ExcepcionHorario   (módulo Horarios de sede)
 *   CAPA 1  turno base semanal    → HorarioProfesional                (aquí: setHorarioBase)
 *   CAPA 2  override por fecha    → EntradaPodologa                   (aquí: setOverrideTurnoFecha)
 *   Ausencias puntuales           → Permisos/Bloqueos (BloqueoAgenda) — NO son responsabilidad
 *                                   de este servicio; no duplicar ese mecanismo aquí.
 *
 * Toda escritura garantiza los TRES efectos que antes estaban regados por las rutas
 * (y a veces faltaban): auditoría en la misma transacción, invalidación de la caché
 * Redis de disponibilidad y evento Socket.io para que las pantallas abiertas refresquen.
 */
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';
import { auditEnTx } from './audit';
import { invalidateDisponibilidadCache, invalidateDisponibilidadFecha, flushDisponibilidadCache } from '../redis';
import { emitirHorarioActualizado } from '../socket';
import { fechaDb, LIMA_OFFSET_H } from '../utils/fechaLima';

const ESTADOS_CANCELADOS = ['cancelada', 'no_show', 'reprogramada'] as const;

function hoyLimaISO(): string {
  return new Date(Date.now() - LIMA_OFFSET_H * 3600_000).toISOString().slice(0, 10);
}

/** "HH:mm" + minutos → "HH:mm" (fin de una cita a partir de inicio + duración). */
function sumarMinutos(hora: string, minutos: number): string {
  const [h, m] = hora.split(':').map((n) => parseInt(n, 10));
  const total = (h || 0) * 60 + (m || 0) + minutos;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

interface Actor { usuarioId?: string; ip?: string }

export interface ConflictoCita { fecha: string; horaInicio: string; paciente?: string }

/** Error 409 con la lista de citas que quedarían fuera del nuevo turno. */
function errorConflicto(conflictos: ConflictoCita[]): AppError {
  const detalle = conflictos.slice(0, 5).map((c) => `${c.fecha} ${c.horaInicio}`).join(', ');
  const extra = conflictos.length > 5 ? ` (+${conflictos.length - 5} más)` : '';
  return new AppError(
    `Hay ${conflictos.length} cita(s) que quedarían FUERA del nuevo turno: ${detalle}${extra}. ` +
    'Muévelas primero, o repite la operación con "forzar" para aplicar de todos modos.',
    409,
    'HORARIO_CONFLICTO_CITAS',
  );
}

// ─── CAPA 2: override de turno por fecha (entrada 8/9 y opcionalmente salida) ──

export async function setOverrideTurnoFecha(opts: {
  profesionalId: string;
  fechas: string[]; // YYYY-MM-DD
  horaInicio: string; // "08:00" | "09:00"
  horaFin?: string; // opcional: sobreescribe también la salida ese día
  forzar?: boolean;
  actor: Actor;
}): Promise<{ fechas: string[] }> {
  const { profesionalId, horaInicio, horaFin, forzar, actor } = opts;
  const prof = await prisma.profesional.findUnique({
    where: { id: profesionalId, deletedAt: null },
    select: { id: true, tipo: true },
  });
  if (!prof) throw new AppError('Profesional no encontrado', 404);
  if (prof.tipo !== 'podologa') throw new AppError('La hora de entrada solo aplica a podólogas', 400);

  // El toggle 8/9 solo tiene sentido Lun-Vie (sábado la base ya es 08:00 y no hay elección).
  const fechas = [...new Set(opts.fechas)].filter((f) => {
    const dow = fechaDb(f).getUTCDay();
    return dow >= 1 && dow <= 5;
  });
  if (fechas.length === 0) return { fechas: [] };

  // Salvaguarda de integridad: citas ya agendadas que quedarían fuera del nuevo turno.
  if (!forzar) {
    const citas = await prisma.cita.findMany({
      where: {
        profesionalId, deletedAt: null,
        fecha: { in: fechas.map(fechaDb) },
        estado: { notIn: [...ESTADOS_CANCELADOS] },
      },
      select: { fecha: true, horaInicio: true, duracionMinutos: true },
    });
    const conflictos: ConflictoCita[] = citas
      .filter((c) => c.horaInicio < horaInicio || (horaFin ? sumarMinutos(c.horaInicio, c.duracionMinutos) > horaFin : false))
      .map((c) => ({ fecha: c.fecha.toISOString().slice(0, 10), horaInicio: c.horaInicio }));
    if (conflictos.length > 0) throw errorConflicto(conflictos);
  }

  await prisma.$transaction(async (tx) => {
    for (const f of fechas) {
      const fecha = fechaDb(f);
      await tx.entradaPodologa.upsert({
        where: { profesionalId_fecha: { profesionalId, fecha } },
        create: { profesionalId, fecha, horaInicio, horaFin: horaFin ?? null, creadoPor: actor.usuarioId },
        update: { horaInicio, horaFin: horaFin ?? null, creadoPor: actor.usuarioId },
      });
    }
    await auditEnTx(tx, {
      usuarioId: actor.usuarioId, ip: actor.ip,
      accion: 'override_turno_fecha', entidad: 'profesional', entidadId: profesionalId,
      despues: { fechas, horaInicio, horaFin: horaFin ?? null },
    });
  });

  await efectosCambioHorario({ profesionalId, fechas });
  return { fechas };
}

// ─── Presencia en un día EXCEPCIONAL habilitado (domingo/feriado abierto) ──────

export async function setPresenciaExcepcion(opts: {
  profesionalId: string;
  sedeId: string;
  fecha: string;
  presente: boolean;
  horaInicio?: string;
  actor: Actor;
}): Promise<void> {
  const { profesionalId, sedeId, fecha, presente, horaInicio, actor } = opts;
  const prof = await prisma.profesional.findUnique({
    where: { id: profesionalId, deletedAt: null },
    select: { id: true, tipo: true },
  });
  if (!prof) throw new AppError('Profesional no encontrado', 404);
  if (prof.tipo !== 'podologa') throw new AppError('Solo aplica a podólogas', 400);

  const fechaPunto = fechaDb(fecha);
  // El día debe estar HABILITADO (excepción de sede abierta) para poder marcar presencia.
  const exc = await prisma.excepcionHorario.findUnique({ where: { sedeId_fecha: { sedeId, fecha: fechaPunto } } });
  if (!(exc && exc.abierto && exc.horaApertura && exc.horaCierre)) {
    throw new AppError('Ese día no está habilitado para la sede. Ábrelo primero en Horarios (excepción).', 400, 'DIA_NO_HABILITADO');
  }

  await prisma.$transaction(async (tx) => {
    if (presente) {
      await tx.entradaPodologa.upsert({
        where: { profesionalId_fecha: { profesionalId, fecha: fechaPunto } },
        create: { profesionalId, fecha: fechaPunto, horaInicio: horaInicio ?? '08:00', creadoPor: actor.usuarioId },
        update: { horaInicio: horaInicio ?? '08:00', creadoPor: actor.usuarioId },
      });
    } else {
      await tx.entradaPodologa.deleteMany({ where: { profesionalId, fecha: fechaPunto } });
    }
    await auditEnTx(tx, {
      usuarioId: actor.usuarioId, ip: actor.ip, sedeId,
      accion: 'presencia_excepcion', entidad: 'profesional', entidadId: profesionalId,
      despues: { sedeId, fecha, presente, horaInicio: horaInicio ?? '08:00' },
    });
  });

  await efectosCambioHorario({ profesionalId, fechas: [fecha], sedeId });
}

// ─── CAPA 1: turno base semanal (días + rango, permanente hasta editarlo) ──────

export interface DiaHorarioBase { diaSemana: number; horaInicio: string; horaFin: string; turno?: string }

export async function setHorarioBase(opts: {
  profesionalId: string;
  dias: DiaHorarioBase[];
  forzar?: boolean;
  actor: Actor;
}): Promise<{ horarios: { diaSemana: number; horaInicio: string; horaFin: string }[] }> {
  const { profesionalId, dias, forzar, actor } = opts;
  const prof = await prisma.profesional.findFirst({
    where: { id: profesionalId, deletedAt: null },
    select: { id: true },
  });
  if (!prof) throw new AppError('Profesional no encontrado', 404);

  const vistos = new Set<number>();
  for (const d of dias) {
    if (vistos.has(d.diaSemana)) throw new AppError('Hay un día repetido en el horario', 400, 'DIA_DUPLICADO');
    vistos.add(d.diaSemana);
    if (d.horaFin <= d.horaInicio) throw new AppError('La hora de fin debe ser mayor que la de inicio', 400, 'RANGO_INVALIDO');
  }

  // Salvaguarda: citas FUTURAS que quedarían fuera del nuevo horario semanal.
  // Se excluyen las fechas con override (capa 2) — esas se rigen por su propia fila.
  if (!forzar) {
    const hoy = fechaDb(hoyLimaISO());
    const [citas, overrides] = await Promise.all([
      prisma.cita.findMany({
        where: { profesionalId, deletedAt: null, fecha: { gte: hoy }, estado: { notIn: [...ESTADOS_CANCELADOS] } },
        select: { fecha: true, horaInicio: true, duracionMinutos: true },
      }),
      prisma.entradaPodologa.findMany({
        where: { profesionalId, fecha: { gte: hoy } },
        select: { fecha: true },
      }),
    ]);
    const fechasOverride = new Set(overrides.map((o) => o.fecha.toISOString().slice(0, 10)));
    const porDia = new Map(dias.map((d) => [d.diaSemana, d]));
    const conflictos: ConflictoCita[] = [];
    for (const c of citas) {
      const iso = c.fecha.toISOString().slice(0, 10);
      if (fechasOverride.has(iso)) continue;
      const d = porDia.get(c.fecha.getUTCDay());
      if (!d || c.horaInicio < d.horaInicio || sumarMinutos(c.horaInicio, c.duracionMinutos) > d.horaFin) {
        conflictos.push({ fecha: iso, horaInicio: c.horaInicio });
      }
    }
    if (conflictos.length > 0) throw errorConflicto(conflictos);
  }

  const antes = await prisma.horarioProfesional.findMany({
    where: { profesionalId, activo: true },
    select: { diaSemana: true, horaInicio: true, horaFin: true },
    orderBy: { diaSemana: 'asc' },
  });

  await prisma.$transaction(async (tx) => {
    for (let dia = 0; dia <= 6; dia++) {
      const d = dias.find((x) => x.diaSemana === dia);
      if (d) {
        await tx.horarioProfesional.upsert({
          where: { profesionalId_diaSemana: { profesionalId, diaSemana: dia } },
          create: { profesionalId, diaSemana: dia, horaInicio: d.horaInicio, horaFin: d.horaFin, turno: (d.turno ?? 'completo') as never, activo: true },
          update: { horaInicio: d.horaInicio, horaFin: d.horaFin, turno: (d.turno ?? 'completo') as never, activo: true },
        });
      } else {
        // Día sin trabajar: desactiva la fila si existía (no atiende ese día).
        await tx.horarioProfesional.updateMany({ where: { profesionalId, diaSemana: dia }, data: { activo: false } });
      }
    }
    await auditEnTx(tx, {
      usuarioId: actor.usuarioId, ip: actor.ip,
      accion: 'editar_horario_semanal', entidad: 'profesional', entidadId: profesionalId,
      antes: { dias: antes }, despues: { dias },
    });
  });

  // El horario semanal afecta MUCHAS fechas futuras → se limpia toda la caché.
  await efectosCambioHorario({ profesionalId, global: true });

  const horarios = await prisma.horarioProfesional.findMany({
    where: { profesionalId, activo: true },
    select: { diaSemana: true, horaInicio: true, horaFin: true },
    orderBy: { diaSemana: 'asc' },
  });
  return { horarios };
}

// ─── Efectos comunes de TODO cambio de horario (caché + tiempo real) ───────────

export async function efectosCambioHorario(opts: {
  profesionalId: string;
  fechas?: string[];
  sedeId?: string;
  global?: boolean;
}): Promise<void> {
  try {
    if (opts.global) {
      await flushDisponibilidadCache();
    } else if (opts.sedeId && opts.fechas) {
      for (const f of opts.fechas) await invalidateDisponibilidadCache(opts.sedeId, f);
    } else if (opts.fechas) {
      // Sin sede conocida (el override no tiene sedeId): invalida la fecha en TODAS las sedes.
      for (const f of opts.fechas) await invalidateDisponibilidadFecha(f);
    }
  } catch { /* la caché tiene TTL; no es crítico */ }
  emitirHorarioActualizado({ profesionalId: opts.profesionalId, fechas: opts.fechas ?? null, global: !!opts.global });
}
