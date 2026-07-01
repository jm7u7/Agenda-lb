import { MotivoMovimiento } from '@prisma/client';
import { addDays, format } from 'date-fns';
import { prisma } from '../db';
import { invalidateDisponibilidadCache } from '../redis';
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

export async function crearMovimiento(data: CrearMovimientoInput) {
  // Guard: los "Adicional" son fijos de su sede y no pueden moverse.
  const prof = await prisma.profesional.findUnique({ where: { id: data.profesionalId }, select: { nombres: true } });
  if (prof && esProfesionalFijo(prof.nombres)) {
    throw new AppError('Los profesionales "Adicional" son fijos de su sede y no pueden moverse.', 400, 'PROFESIONAL_FIJO');
  }

  const nuevaFechaInicio = toDate(data.fechaInicio);
  const nuevaFechaFin = data.fechaFin ? toDate(data.fechaFin) : null;

  const { asignacion: nueva, sedeAnteriorId } = await prisma.$transaction(async (tx) => {
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
      sedeAnteriorId = actual.sedeId;
      cierraAsignacionId = actual.id;
      cierraFechaFin = actual.fechaFin; // fechaFin ORIGINAL (null si era indefinida) para restaurar exacto
      const fechaFinCierre = addDays(nuevaFechaInicio, -1);
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
  });

  // ── 4 y 5. Refrescar agenda (cache Redis + Socket.io) ──────────────────────
  await notificarCambioMovimiento({
    profesionalId: data.profesionalId,
    sedeId: data.sedeId,
    sedeAnteriorId: sedeAnteriorId ?? null,
    fechaInicio: nuevaFechaInicio,
    fechaFin: nuevaFechaFin,
  });

  return nueva;
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
  const maxDias = 90;
  const fin = p.fechaFin ?? addDays(p.fechaInicio, maxDias);
  for (let d = new Date(p.fechaInicio); d <= fin; d = addDays(d, 1)) {
    const f = format(d, 'yyyy-MM-dd');
    await invalidateDisponibilidadCache(p.sedeId, f);
    if (p.sedeAnteriorId) await invalidateDisponibilidadCache(p.sedeAnteriorId, f);
  }

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
    descripcion,
  };
}
