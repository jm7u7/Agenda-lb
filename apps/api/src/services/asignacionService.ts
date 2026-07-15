import { MotivoMovimiento, Prisma } from '@prisma/client';
import { addDays, format } from 'date-fns';
import { prisma } from '../db';
import { invalidateDisponibilidadSede } from '../redis';
import { getIO } from '../socket';
import { AppError, CitasPendientesError } from '../middleware/errorHandler';
import { fechaDb } from '../utils/fechaLima';
import { auditEnTx } from './audit';

export interface CrearMovimientoInput {
  profesionalId: string;
  sedeId: string;
  fechaInicio: string; // YYYY-MM-DD
  fechaFin: string | null; // YYYY-MM-DD | null
  motivo: MotivoMovimiento;
  reemplazaA?: string | null;
  notas?: string | null;
  creadoPor: string;
}

const MOTIVO_LABELS: Record<MotivoMovimiento, string> = {
  VACACIONES: 'Vacaciones',
  CAMBIO_POR_TIEMPO: 'Cambio por tiempo',
  CERCANIA_A_CASA: 'Cercanía a casa',
  PROBLEMAS_INTERNOS: 'Problemas internos',
  COBERTURA_EMERGENCIA: 'Cobertura emergencia',
  OTRO: 'Otro',
};

export { MOTIVO_LABELS };

// Fechas @db.Date ancladas a MEDIODÍA UTC (util central) — TZ-independiente.
function toDate(str: string): Date {
  return fechaDb(str);
}

function fechaLabel(d: Date): string {
  return d.toLocaleDateString('es-PE', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });
}

// Los profesionales "Adicional" (capacidad extra fija de cada sede) NUNCA se mueven.
export function esProfesionalFijo(nombres: string): boolean {
  return nombres.trim().toLowerCase() === 'adicional';
}

// ─── Coordinación Movimientos ↔ Vacaciones (que las tablas "se hablen") ──────────
// Las vacaciones viven en `bloqueos_agenda` (esVacaciones=true, un bloqueo de día
// completo por día). Un movimiento NO puede pisar días de vacación del profesional:
// si el rango del movimiento solapa CUALQUIER día de vacación, se rechaza. Así
// Movimientos deja de poder sacar a alguien de su vacación (o "cerrarla") en silencio.
export async function vacacionesEnRango(
  db: Pick<Prisma.TransactionClient, 'bloqueoAgenda'>,
  profesionalId: string,
  ini: Date,
  fin: Date | null,
): Promise<{ desde: Date; hasta: Date; dias: number } | null> {
  const diaUtc = (d: Date, h: number, m: number, s: number) =>
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m, s));
  const rangeStart = diaUtc(ini, 0, 0, 0);
  // Movimiento sin fecha de fin (abierto): se revisa una ventana de 1 año hacia adelante.
  const finBound = fin ?? addDays(ini, 365);
  const rangeEnd = diaUtc(finBound, 23, 59, 59);
  const rows = await db.bloqueoAgenda.findMany({
    where: {
      profesionalId,
      esVacaciones: true,
      deletedAt: null,
      fechaInicio: { gte: rangeStart, lte: rangeEnd },
    },
    orderBy: { fechaInicio: 'asc' },
    select: { fechaInicio: true },
  });
  if (rows.length === 0) return null;
  return { desde: rows[0]!.fechaInicio, hasta: rows[rows.length - 1]!.fechaInicio, dias: rows.length };
}

// Núcleo de la creación, COMPONIBLE dentro de una transacción externa (lo usan
// crearMovimiento y la edición estructural de PUT /movimientos/:id, que recrea).
export async function crearMovimientoEnTx(tx: Prisma.TransactionClient, data: CrearMovimientoInput) {
  // Las vacaciones NO se registran por Movimientos: van a Permisos → Vacaciones
  // (tabla bloqueos_agenda). Bloqueamos el motivo para que las dos tablas no se pisen.
  if (data.motivo === 'VACACIONES') {
    throw new AppError('Las vacaciones se registran en Permisos → Vacaciones, no en Movimientos.', 400, 'MOTIVO_VACACIONES_NO_PERMITIDO');
  }

  // Guard: los "Adicional" son fijos de su sede y no pueden moverse.
  const prof = await tx.profesional.findUnique({ where: { id: data.profesionalId }, select: { nombres: true, apellidos: true } });
  if (prof && esProfesionalFijo(prof.nombres)) {
    throw new AppError('Los profesionales "Adicional" son fijos de su sede y no pueden moverse.', 400, 'PROFESIONAL_FIJO');
  }

  const nuevaFechaInicio = toDate(data.fechaInicio);
  const nuevaFechaFin = data.fechaFin ? toDate(data.fechaFin) : null;

  {
    // ── 0. Verificar citas pendientes (DENTRO de la transacción para cerrar la
    //       ventana TOCTOU). ROBUSTEZ: se cuentan TODAS las citas activas de la
    //       podóloga en el período, en CUALQUIER sede (no solo la de origen) — así
    //       el chequeo nunca pierde citas por un desajuste de sede, igual que
    //       `verificar-citas`. ───────────────────────────────────────────────
    const asignacionOrigen = await tx.asignacionSede.findFirst({
      where: {
        profesionalId: data.profesionalId,
        activa: true,
        fechaInicio: { lte: nuevaFechaInicio },
        OR: [{ fechaFin: null }, { fechaFin: { gte: nuevaFechaInicio } }],
      },
      select: { sedeId: true },
    });
    const totalCitas = await tx.cita.count({
      where: {
        profesionalId: data.profesionalId,
        fecha: { gte: nuevaFechaInicio, lte: nuevaFechaFin ?? addDays(nuevaFechaInicio, 365) },
        estado: { in: ['agendada', 'confirmada', 'llego', 'en_atencion'] },
        deletedAt: null,
      },
    });
    if (totalCitas > 0) throw new CitasPendientesError(totalCitas, asignacionOrigen?.sedeId ?? data.sedeId);

    // ── 0-bis. Coordinación con VACACIONES: un movimiento no puede pisar días de
    //          vacación del profesional (las tablas se hablan). ──────────────────
    const vac = await vacacionesEnRango(tx, data.profesionalId, nuevaFechaInicio, nuevaFechaFin);
    if (vac) {
      const nom = prof ? `${prof.nombres.split(' ')[0]} ${prof.apellidos.split(' ')[0]}` : 'la profesional';
      throw new AppError(
        `No se puede mover a ${nom}: tiene vacaciones del ${fechaLabel(vac.desde)} al ${fechaLabel(vac.hasta)}. Ajusta el rango del movimiento o elimina/edita las vacaciones primero.`,
        409,
        'VACACIONES_EN_PERIODO',
      );
    }

    // ── 1. Encontrar y cerrar la asignación vigente ─────────────────────────
    const actual = await tx.asignacionSede.findFirst({
      where: {
        profesionalId: data.profesionalId,
        activa: true,
        fechaInicio: { lte: nuevaFechaInicio },
        OR: [{ fechaFin: null }, { fechaFin: { gte: nuevaFechaInicio } }],
      },
      orderBy: { fechaInicio: 'desc' },
      include: { sede: true, profesional: true },
    });

    let sedeAnteriorId: string | undefined;
    let cierraAsignacionId: string | null = null;
    let cierraFechaFin: Date | null = null;

    if (actual) {
      const fechaFinCierre = addDays(nuevaFechaInicio, -1);
      // GUARD anti-rango-invertido: si la asignación vigente EMPIEZA el mismo día (o después)
      // del nuevo movimiento, cerrarla en inicio-1 la dejaría con fin < inicio (fila zombi que
      // corrompe agenda y tablero). Eso es un CONFLICTO real: ya hay un movimiento ese día.
      if (fechaFinCierre < actual.fechaInicio) {
        throw new AppError(
          `${actual.profesional.nombres} ${actual.profesional.apellidos} ya tiene un movimiento a ${actual.sede.nombre} que empieza el ${fechaLabel(actual.fechaInicio)}. Edita o elimina ese movimiento en vez de crear otro encima.`,
          409,
          'CONFLICTO_ASIGNACION',
        );
      }
      sedeAnteriorId = actual.sedeId;
      cierraAsignacionId = actual.id;
      cierraFechaFin = actual.fechaFin; // fechaFin ORIGINAL (null si era indefinida) para restaurar exacto
      await tx.asignacionSede.update({
        where: { id: actual.id },
        data: { activa: false, fechaFin: fechaFinCierre },
      });
    }

    // ── 2. Verificar solapamiento con otras asignaciones ────────────────────
    const conflicto = await tx.asignacionSede.findFirst({
      where: {
        profesionalId: data.profesionalId,
        activa: true,
        ...(nuevaFechaFin ? { fechaInicio: { lte: nuevaFechaFin } } : {}),
        OR: [{ fechaFin: null }, { fechaFin: { gte: nuevaFechaInicio } }],
      },
      include: { sede: true, profesional: true },
    });

    if (conflicto) {
      const ini = fechaLabel(conflicto.fechaInicio);
      const fin = conflicto.fechaFin ? fechaLabel(conflicto.fechaFin) : 'indefinido';
      throw new AppError(
        `Conflicto: ${conflicto.profesional.nombres} ${conflicto.profesional.apellidos} ya está asignada a ${conflicto.sede.nombre} del ${ini} al ${fin}`,
        409,
        'CONFLICTO_ASIGNACION',
      );
    }

    // ── 3. Crear nueva asignación ────────────────────────────────────────────
    const asignacion = await tx.asignacionSede.create({
      data: {
        profesionalId: data.profesionalId,
        sedeId: data.sedeId,
        fechaInicio: nuevaFechaInicio,
        fechaFin: nuevaFechaFin,
        activa: true,
        motivo: data.motivo,
        reemplazaA: data.reemplazaA ?? null,
        notas: data.notas ?? null,
        creadoPor: data.creadoPor,
        cierraAsignacionId,
        cierraFechaFin,
      },
      include: {
        profesional: { select: { id: true, nombres: true, apellidos: true } },
        sede: { select: { id: true, nombre: true } },
        reemplazaProfesional: { select: { id: true, nombres: true, apellidos: true } },
        creadoPorUsuario: { select: { id: true, nombre: true } },
      },
    });

    // ── 3-bis. RETORNO a la sede matriz tras un movimiento TEMPORAL ─────────
    // Si el movimiento tiene fecha de fin y cerró una asignación previa, al terminar
    // la profesional debe VOLVER a su sede matriz. Creamos la asignación de retorno
    // (desde el día siguiente al fin) con el fin ORIGINAL de la base (null = indefinida).
    // Sin esto, el día siguiente al movimiento la profesional quedaba SIN sede vigente.
    if (nuevaFechaFin && actual) {
      const retornoInicio = addDays(nuevaFechaFin, 1);
      // Solo si la base no habría terminado antes del retorno.
      if (cierraFechaFin === null || cierraFechaFin >= retornoInicio) {
        await tx.asignacionSede.create({
          data: {
            profesionalId: data.profesionalId,
            sedeId: actual.sedeId,
            fechaInicio: retornoInicio,
            fechaFin: cierraFechaFin, // fin original de la base (null = indefinida)
            activa: true,
            esRetorno: true, // marca estructural — la sincronización/borrado se guía por esto
            motivo: data.motivo,
            notas: `Retorno automático a ${actual.sede.nombre} tras ${MOTIVO_LABELS[data.motivo]}`,
            creadoPor: data.creadoPor,
          },
        });
      }
    }

    // Audit del movimiento DENTRO de la transacción (antes solo se auditaba el
    // borrado; ahora la creación de rotación también deja rastro inmutable).
    await auditEnTx(tx, {
      usuarioId: data.creadoPor,
      accion: 'MOVIMIENTO_CREADO',
      entidad: 'asignacion_sede',
      entidadId: asignacion.id,
      antes: cierraAsignacionId
        ? { cerroAsignacionId: cierraAsignacionId, sedeAnterior: sedeAnteriorId ?? null }
        : { sedeAnterior: null },
      despues: {
        profesionalId: data.profesionalId,
        sedeId: data.sedeId,
        fechaInicio: data.fechaInicio,
        fechaFin: data.fechaFin,
        motivo: data.motivo,
      },
      sedeId: data.sedeId,
    });

    return { asignacion, sedeAnteriorId };
  }
}

export async function crearMovimiento(data: CrearMovimientoInput) {
  const { asignacion: nueva, sedeAnteriorId } = await prisma.$transaction(
    (tx) => crearMovimientoEnTx(tx, data),
  );

  // ── 4 y 5. Refrescar agenda (cache Redis + Socket.io) ──────────────────────
  await notificarCambioMovimiento({
    profesionalId: data.profesionalId,
    sedeId: data.sedeId,
    sedeAnteriorId: sedeAnteriorId ?? null,
    fechaInicio: toDate(data.fechaInicio),
    fechaFin: data.fechaFin ? toDate(data.fechaFin) : null,
  });

  return nueva;
}

// ─── Eliminación componible (la usan DELETE /movimientos/:id y la edición
//     estructural de PUT, que recrea el movimiento) ───────────────────────────

// Halla la asignación PREVIA que este movimiento cerró (la que se restauraría al
// eliminarlo). Si no hay → el movimiento es la asignación BASE: eliminarlo deja
// a la profesional sin sede.
export async function hallarPredecesor(
  db: Pick<Prisma.TransactionClient, 'asignacionSede'>,
  asignacion: { profesionalId: string; fechaInicio: Date; cierraAsignacionId: string | null; cierraFechaFin: Date | null },
): Promise<{ predecesorId: string; predecesorSedeId: string; restaurarFechaFin: Date | null; exacto: boolean } | null> {
  if (asignacion.cierraAsignacionId) {
    const prev = await db.asignacionSede.findUnique({ where: { id: asignacion.cierraAsignacionId } });
    if (prev) return { predecesorId: prev.id, predecesorSedeId: prev.sedeId, restaurarFechaFin: asignacion.cierraFechaFin, exacto: true };
  }
  // Fallback para movimientos antiguos: asignación cerrada el día anterior al inicio.
  const diaAntes = addDays(asignacion.fechaInicio, -1);
  const d0 = new Date(Date.UTC(diaAntes.getUTCFullYear(), diaAntes.getUTCMonth(), diaAntes.getUTCDate(), 0, 0, 0));
  const d1 = new Date(Date.UTC(diaAntes.getUTCFullYear(), diaAntes.getUTCMonth(), diaAntes.getUTCDate(), 23, 59, 59));
  const prev = await db.asignacionSede.findFirst({
    where: { profesionalId: asignacion.profesionalId, activa: false, fechaFin: { gte: d0, lte: d1 } },
    orderBy: { fechaInicio: 'desc' },
  });
  if (prev) return { predecesorId: prev.id, predecesorSedeId: prev.sedeId, restaurarFechaFin: null, exacto: false };
  return null;
}

/**
 * Elimina un movimiento DENTRO de una transacción: borra la fila, borra su retorno
 * automático (si era temporal) y restaura la asignación previa a su estado exacto.
 * Devuelve la sede del predecesor restaurado (para notificar la agenda).
 */
export async function eliminarMovimientoEnTx(
  tx: Prisma.TransactionClient,
  asignacion: {
    id: string; profesionalId: string; sedeId: string;
    fechaInicio: Date; fechaFin: Date | null;
    cierraAsignacionId: string | null; cierraFechaFin: Date | null;
  },
  actor: { usuarioId?: string; ip?: string },
): Promise<{ predecesorSedeId: string | null }> {
  const pred = await hallarPredecesor(tx, asignacion);

  // Borrar el movimiento ANTES de restaurar el predecesor: si el predecesor vuelve a
  // quedar indefinido (fechaFin=null), no debe coexistir un instante con el movimiento
  // (también abierto) → respeta el índice "una sola asignación abierta por profesional".
  await tx.asignacionSede.delete({ where: { id: asignacion.id } });

  // Si el movimiento era TEMPORAL, se creó una asignación de RETORNO a la sede previa
  // (desde el día siguiente al fin). Eliminarla también, si no al reabrir el predecesor
  // quedarían DOS asignaciones abiertas de la misma sede (viola el índice).
  if (asignacion.fechaFin) {
    const rIni = addDays(asignacion.fechaFin, 1);
    const d0 = new Date(Date.UTC(rIni.getUTCFullYear(), rIni.getUTCMonth(), rIni.getUTCDate(), 0, 0, 0));
    const d1 = new Date(Date.UTC(rIni.getUTCFullYear(), rIni.getUTCMonth(), rIni.getUTCDate(), 23, 59, 59));
    await tx.asignacionSede.deleteMany({
      // SOLO filas marcadas como retorno (sin la marca, un movimiento real podría borrarse
      // por error). SIN filtro de sede: si el usuario REDIRIGIÓ el retorno a otra sede,
      // sigue siendo el retorno de ESTE movimiento y debe eliminarse igual — dejarlo vivo
      // chocaría con la asignación restaurada (dos abiertas) y el deshacer fallaría.
      where: { profesionalId: asignacion.profesionalId, esRetorno: true, fechaInicio: { gte: d0, lte: d1 } },
    });
  }

  if (pred) {
    await tx.asignacionSede.update({
      where: { id: pred.predecesorId },
      data: { activa: true, fechaFin: pred.restaurarFechaFin },
    });
  }

  await tx.auditLog.create({
    data: {
      usuarioId: actor.usuarioId,
      accion: 'MOVIMIENTO_ELIMINADO',
      entidad: 'asignacion_sede',
      entidadId: asignacion.id,
      antes: { profesionalId: asignacion.profesionalId, sedeId: asignacion.sedeId, fechaInicio: asignacion.fechaInicio.toISOString().slice(0, 10), fechaFin: asignacion.fechaFin?.toISOString().slice(0, 10) ?? null },
      despues: { eliminado: true, predecesorRestaurado: !!pred, restauradoExacto: pred?.exacto ?? false, fechaFinRestaurada: pred?.restaurarFechaFin ? pred.restaurarFechaFin.toISOString().slice(0, 10) : null },
      sedeId: asignacion.sedeId,
      ip: actor.ip,
    },
  });

  return { predecesorSedeId: pred?.predecesorSedeId ?? null };
}

/**
 * Invalida la caché de disponibilidad y emite el evento Socket.io para que la
 * agenda de las sedes afectadas se refresque al instante (sin pasos manuales).
 * Lo usan tanto la creación como la eliminación de movimientos.
 */
export async function notificarCambioMovimiento(p: {
  profesionalId: string;
  sedeId: string;                 // sede del movimiento (donde aparece/desaparece la columna)
  sedeAnteriorId: string | null;  // sede previa (a donde vuelve, en una eliminación)
  fechaInicio: Date;
  fechaFin: Date | null;
}): Promise<void> {
  // Un movimiento afecta MUCHAS fechas de sus dos sedes: se invalida TODA la caché de
  // cada sede en UNA sola pasada (antes: hasta 180 comandos KEYS secuenciales a Redis,
  // uno por día — lento y bloqueante).
  await invalidateDisponibilidadSede(p.sedeId);
  if (p.sedeAnteriorId) await invalidateDisponibilidadSede(p.sedeAnteriorId);

  const io = getIO();
  if (io) {
    const payload = {
      tipo: 'movimiento:guardado',
      profesionalId: p.profesionalId,
      sedeId: p.sedeId,
      sedeAnteriorId: p.sedeAnteriorId ?? null,
      fechaInicio: format(p.fechaInicio, 'yyyy-MM-dd'),
      fechaFin: p.fechaFin ? format(p.fechaFin, 'yyyy-MM-dd') : null,
    };
    if (p.sedeAnteriorId) io.to(`sede:${p.sedeAnteriorId}`).emit('movimiento:guardado', payload);
    io.to(`sede:${p.sedeId}`).emit('movimiento:guardado', payload);
    io.emit('movimiento:guardado', payload); // broadcast a coordinadoras
  }
}

export async function previewMovimiento(params: {
  profesionalId: string;
  sedeId: string;
  fechaInicio: string;
  fechaFin: string | null;
}) {
  const nuevaFechaInicio = toDate(params.fechaInicio);
  const nuevaFechaFin = params.fechaFin ? toDate(params.fechaFin) : null;

  const [profesional, sedeDest, asignacionActual] = await Promise.all([
    prisma.profesional.findUnique({
      where: { id: params.profesionalId },
      select: { nombres: true, apellidos: true },
    }),
    prisma.sede.findUnique({ where: { id: params.sedeId }, select: { nombre: true } }),
    prisma.asignacionSede.findFirst({
      where: {
        profesionalId: params.profesionalId,
        activa: true,
        fechaInicio: { lte: nuevaFechaInicio },
        OR: [{ fechaFin: null }, { fechaFin: { gte: nuevaFechaInicio } }],
      },
      orderBy: { fechaInicio: 'desc' },
      include: { sede: true },
    }),
  ]);

  if (!profesional || !sedeDest) return null;

  const nombre = `${profesional.nombres.split(' ')[0]} ${profesional.apellidos.split(' ')[0]}`;

  // Coordinación con vacaciones: avisar (y bloquear el guardado) si el rango pisa vacación.
  const vac = await vacacionesEnRango(prisma, params.profesionalId, nuevaFechaInicio, nuevaFechaFin);

  // Detectar conflicto sin cerrar nada
  const conflicto = await prisma.asignacionSede.findFirst({
    where: {
      profesionalId: params.profesionalId,
      activa: true,
      id: asignacionActual ? { not: asignacionActual.id } : undefined,
      ...(nuevaFechaFin ? { fechaInicio: { lte: nuevaFechaFin } } : {}),
      OR: [{ fechaFin: null }, { fechaFin: { gte: nuevaFechaInicio } }],
    },
    include: { sede: true },
  });

  // Próxima asignación ya programada (después del nuevo fechaFin)
  const proxima = nuevaFechaFin
    ? await prisma.asignacionSede.findFirst({
        where: {
          profesionalId: params.profesionalId,
          activa: true,
          fechaInicio: { gt: nuevaFechaFin },
        },
        orderBy: { fechaInicio: 'asc' },
        include: { sede: true },
      })
    : null;

  // Construir descripción legible
  const iniLabel = fechaLabel(nuevaFechaInicio);
  const finLabel = nuevaFechaFin ? fechaLabel(nuevaFechaFin) : null;
  const cierreLabel = asignacionActual
    ? fechaLabel(addDays(nuevaFechaInicio, -1))
    : null;

  let descripcion = `${nombre} estará en ${sedeDest.nombre} del ${iniLabel}`;
  descripcion += finLabel ? ` al ${finLabel}.` : ' en adelante (sin fecha de fin).';
  if (asignacionActual && cierreLabel) {
    descripcion += ` Su asignación en ${asignacionActual.sede.nombre} se cerrará el ${cierreLabel}.`;
  }
  if (proxima) {
    descripcion += ` Desde el ${fechaLabel(proxima.fechaInicio)} continuará en ${proxima.sede.nombre}.`;
  } else if (nuevaFechaFin) {
    descripcion += ` Desde el ${fechaLabel(addDays(nuevaFechaFin, 1))} continuará sin sede asignada.`;
  }

  return {
    asignacionActual: asignacionActual
      ? { sedeId: asignacionActual.sedeId, sedeNombre: asignacionActual.sede.nombre, fechaFinCalculado: cierreLabel }
      : null,
    nuevaAsignacion: { sedeNombre: sedeDest.nombre, fechaInicio: iniLabel, fechaFin: finLabel },
    proximaAsignacion: proxima
      ? { sedeNombre: proxima.sede.nombre, fechaInicio: fechaLabel(proxima.fechaInicio) }
      : null,
    conflicto: conflicto
      ? { mensaje: `Conflicto con asignación existente en ${conflicto.sede.nombre} (${fechaLabel(conflicto.fechaInicio)} – ${conflicto.fechaFin ? fechaLabel(conflicto.fechaFin) : 'indefinido'})` }
      : null,
    vacaciones: vac
      ? { desde: fechaLabel(vac.desde), hasta: fechaLabel(vac.hasta), dias: vac.dias,
          mensaje: `${nombre} tiene vacaciones del ${fechaLabel(vac.desde)} al ${fechaLabel(vac.hasta)} — el movimiento no puede pisar esos días.` }
      : null,
    descripcion,
  };
}
