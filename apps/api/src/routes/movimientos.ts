import { Router } from 'express';
import { z } from 'zod';
import { MotivoMovimiento } from '@prisma/client';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { crearMovimiento, previewMovimiento, notificarCambioMovimiento, MOTIVO_LABELS } from '../services/asignacionService';
import { CitasPendientesError } from '../middleware/errorHandler';
import { fechaDb } from '../utils/fechaLima';
import { addDays } from 'date-fns';

const router = Router();

const motivoEnum = z.nativeEnum(MotivoMovimiento);

const crearSchema = z.object({
  profesionalId: z.string().uuid(),
  sedeId: z.string().uuid(),
  fechaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fechaFin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  motivo: motivoEnum,
  reemplazaA: z.string().uuid().nullable().optional(),
  notas: z.string().max(500).nullable().optional(),
});

const editarSchema = z.object({
  fechaFin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  motivo: motivoEnum.optional(),
  notas: z.string().max(500).nullable().optional(),
});

// ─── Include reutilizable ──────────────────────────────────────────────────────
const INCLUDE_COMPLETO = {
  profesional: {
    select: {
      id: true, nombres: true, apellidos: true, colorAvatar: true,
    },
  },
  sede: { select: { id: true, nombre: true, color: true } },
  reemplazaProfesional: { select: { id: true, nombres: true, apellidos: true } },
  creadoPorUsuario: { select: { id: true, nombre: true } },
} as const;

// Halla la asignación PREVIA que este movimiento cerró (la que se restauraría al
// eliminarlo). Si no hay → el movimiento es la asignación BASE: eliminarlo deja
// a la profesional sin sede. Misma lógica que usa el DELETE.
async function hallarPredecesor(asignacion: {
  profesionalId: string; fechaInicio: Date; cierraAsignacionId: string | null; cierraFechaFin: Date | null;
}): Promise<{ predecesorId: string; predecesorSedeId: string; restaurarFechaFin: Date | null; exacto: boolean } | null> {
  if (asignacion.cierraAsignacionId) {
    const prev = await prisma.asignacionSede.findUnique({ where: { id: asignacion.cierraAsignacionId } });
    if (prev) return { predecesorId: prev.id, predecesorSedeId: prev.sedeId, restaurarFechaFin: asignacion.cierraFechaFin, exacto: true };
  }
  // Fallback para movimientos antiguos: asignación cerrada el día anterior al inicio.
  const diaAntes = addDays(asignacion.fechaInicio, -1);
  const d0 = new Date(Date.UTC(diaAntes.getUTCFullYear(), diaAntes.getUTCMonth(), diaAntes.getUTCDate(), 0, 0, 0));
  const d1 = new Date(Date.UTC(diaAntes.getUTCFullYear(), diaAntes.getUTCMonth(), diaAntes.getUTCDate(), 23, 59, 59));
  const prev = await prisma.asignacionSede.findFirst({
    where: { profesionalId: asignacion.profesionalId, activa: false, fechaFin: { gte: d0, lte: d1 } },
    orderBy: { fechaInicio: 'desc' },
  });
  if (prev) return { predecesorId: prev.id, predecesorSedeId: prev.sedeId, restaurarFechaFin: null, exacto: false };
  return null;
}

// ─── GET /movimientos/verificar-citas ─────────────────────────────────────────
router.get('/verificar-citas', requireAuth, async (req, res) => {
  const { profesionalId, fechaInicio, fechaFin } = req.query as Record<string, string>;
  if (!profesionalId || !fechaInicio) {
    throw new AppError('Faltan parámetros: profesionalId, fechaInicio', 400);
  }

  const inicio = fechaDb(fechaInicio);
  const fin = fechaFin ? fechaDb(fechaFin) : addDays(inicio, 365);
  const ESTADOS_BLOQUEANTES = ['agendada', 'confirmada', 'llego', 'en_atencion'];

  // ROBUSTEZ: se listan TODAS las citas activas de la podóloga en el período, en
  // CUALQUIER sede (no solo la de origen). Mover una podóloga la afecta en todos lados,
  // así que la lista nunca debe perder citas por un desajuste de sede. La sede de cada
  // cita se muestra para contexto. (Coincide con el chequeo de crearMovimiento.)
  const citas = await prisma.cita.findMany({
    where: {
      profesionalId,
      fecha: { gte: inicio, lte: fin },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      estado: { in: ESTADOS_BLOQUEANTES as any },
      deletedAt: null,
    },
    include: {
      paciente: { select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true, telefono: true, email: true } },
      servicio: { select: { nombre: true, duracionMinutos: true } },
      sede: { select: { nombre: true } },
    },
    orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
  });

  const resumenMap = new Map<string, number>();
  for (const c of citas) {
    const fechaStr = c.fecha.toISOString().split('T')[0]!;
    resumenMap.set(fechaStr, (resumenMap.get(fechaStr) ?? 0) + 1);
  }

  const citasFormateadas = citas.map(c => {
    const [hh, mm] = c.horaInicio.split(':').map(Number);
    const totalMin = hh * 60 + mm + c.servicio.duracionMinutos;
    const horaFin = `${Math.floor(totalMin / 60).toString().padStart(2, '0')}:${(totalMin % 60).toString().padStart(2, '0')}`;
    return {
      id: c.id,
      fecha: c.fecha.toISOString().split('T')[0]!,
      horaInicio: c.horaInicio,
      horaFin,
      estado: c.estado as string,
      paciente: {
        nombreCompleto: `${c.paciente.nombres} ${c.paciente.apellidoPaterno} ${c.paciente.apellidoMaterno}`.trim(),
        telefono: c.paciente.telefono,
        email: c.paciente.email,
      },
      servicio: c.servicio.nombre,
      sede: c.sede.nombre,
    };
  });

  res.json({
    bloqueado: citas.length > 0,
    totalCitas: citas.length,
    resumenPorDia: [...resumenMap.entries()].map(([fecha, cantidad]) => ({ fecha, cantidad })),
    citas: citasFormateadas,
  });
});

// ─── GET /movimientos/:id/impacto ─── consecuencias de eliminar (para confirmar) ─
router.get('/:id/impacto', requireAuth, async (req, res) => {
  const asignacion = await prisma.asignacionSede.findUnique({
    where: { id: req.params.id },
    include: { profesional: { select: { nombres: true, apellidos: true } }, sede: { select: { nombre: true } } },
  });
  if (!asignacion) throw new AppError('Movimiento no encontrado', 404);

  const pred = await hallarPredecesor(asignacion);
  let sedeAnteriorNombre: string | null = null;
  if (pred) {
    const s = await prisma.sede.findUnique({ where: { id: pred.predecesorSedeId }, select: { nombre: true } });
    sedeAnteriorNombre = s?.nombre ?? null;
  }

  // Citas afectadas: de la profesional en ESTA sede, de hoy en adelante dentro del periodo.
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const inicio = asignacion.fechaInicio > hoy ? asignacion.fechaInicio : hoy;
  const fin = asignacion.fechaFin ?? addDays(inicio, 365);
  const citasAfectadas = await prisma.cita.count({
    where: {
      profesionalId: asignacion.profesionalId,
      sedeId: asignacion.sedeId,
      fecha: { gte: inicio, lte: fin },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      estado: { in: ['agendada', 'confirmada', 'llego', 'en_atencion'] as any },
      deletedAt: null,
    },
  });

  res.json({
    tienePredecesor: !!pred,
    sedeAnteriorNombre,
    citasAfectadas,
    profesional: `${asignacion.profesional.nombres} ${asignacion.profesional.apellidos}`,
    sede: asignacion.sede.nombre,
  });
});

// ─── GET /movimientos/preview ──────────────────────────────────────────────────
router.get('/preview', requireAuth, async (req, res) => {
  const { profesionalId, sedeId, fechaInicio, fechaFin } = req.query as Record<string, string>;
  if (!profesionalId || !sedeId || !fechaInicio) {
    throw new AppError('Faltan parámetros: profesionalId, sedeId, fechaInicio', 400);
  }
  const result = await previewMovimiento({
    profesionalId,
    sedeId,
    fechaInicio,
    fechaFin: fechaFin || null,
  });
  res.json(result);
});

// ─── GET /movimientos ──────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { profesionalId, sedeId, desde, hasta, estado } = req.query as Record<string, string>;

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {};
  if (profesionalId) where.profesionalId = profesionalId;
  if (sedeId) where.sedeId = sedeId;

  if (estado === 'activo') {
    where.activa = true;
    where.fechaInicio = { lte: hoy };
    where.OR = [{ fechaFin: null }, { fechaFin: { gte: hoy } }];
  } else if (estado === 'proximo') {
    where.activa = true;
    where.fechaInicio = { gt: hoy };
  } else if (estado === 'historial') {
    where.OR = [{ activa: false }, { fechaFin: { lt: hoy } }];
  }

  if (desde) where.fechaInicio = { ...where.fechaInicio, gte: fechaDb(desde) };
  if (hasta) where.fechaFin = { ...where.fechaFin, lte: fechaDb(hasta) };

  const asignaciones = await prisma.asignacionSede.findMany({
    where,
    include: INCLUDE_COMPLETO,
    orderBy: { fechaInicio: 'asc' },
  });

  const hoyMs = hoy.getTime();
  const en7DiasMs = addDays(hoy, 7).getTime();

  res.json(asignaciones.map(a => ({
    ...a,
    motivoLabel: MOTIVO_LABELS[a.motivo],
    estadoCalc: (() => {
      if (!a.activa) return 'historial';
      const inicio = a.fechaInicio.getTime();
      if (inicio > en7DiasMs) return 'futuro';
      if (inicio > hoyMs) return 'proximo'; // ≤ 7 días
      if (!a.fechaFin || a.fechaFin.getTime() >= hoyMs) return 'activo';
      return 'historial';
    })(),
  })));
});

// ─── POST /movimientos ─────────────────────────────────────────────────────────
router.post('/', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const data = crearSchema.parse(req.body);
  const creadoPor = req.user!.userId;

  try {
    const nueva = await crearMovimiento({
      profesionalId: data.profesionalId,
      sedeId: data.sedeId,
      fechaInicio: data.fechaInicio,
      fechaFin: data.fechaFin ?? null,
      motivo: data.motivo,
      reemplazaA: data.reemplazaA ?? null,
      notas: data.notas ?? null,
      creadoPor,
    });
    res.status(201).json(nueva);
  } catch (err) {
    if (err instanceof CitasPendientesError) {
      return res.status(409).json({
        error: 'CITAS_PENDIENTES',
        message: err.message,
        totalCitas: err.totalCitas,
        sedeOrigenId: err.sedeOrigenId,
      });
    }
    throw err;
  }
});

// ─── PUT /movimientos/:id ──────────────────────────────────────────────────────
router.put('/:id', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const data = editarSchema.parse(req.body);

  const existente = await prisma.asignacionSede.findUnique({
    where: { id: req.params.id },
  });
  if (!existente) throw new AppError('Movimiento no encontrado', 404);

  const actualizado = await prisma.asignacionSede.update({
    where: { id: req.params.id },
    data: {
      ...(data.fechaFin !== undefined
        ? { fechaFin: data.fechaFin ? fechaDb(data.fechaFin) : null }
        : {}),
      ...(data.motivo !== undefined ? { motivo: data.motivo } : {}),
      ...(data.notas !== undefined ? { notas: data.notas } : {}),
    },
    include: INCLUDE_COMPLETO,
  });

  res.json(actualizado);
});

// ─── DELETE /movimientos/:id ───────────────────────────────────────────────────
router.delete('/:id', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const asignacion = await prisma.asignacionSede.findUnique({
    where: { id: req.params.id },
  });
  if (!asignacion) throw new AppError('Movimiento no encontrado', 404);

  // Se puede eliminar tanto un movimiento futuro como uno ACTIVO (ya iniciado):
  // en ambos casos se restaura la asignación previa y se refresca la agenda.
  //  1) Restaurar EXACTO la asignación previa que ESTE movimiento cerró, usando los datos
  //     guardados al crearlo (`cierraAsignacionId` + `cierraFechaFin` = su fechaFin original,
  //     null = era indefinida). Para movimientos antiguos sin esos campos, fallback heurístico
  //     (la asignación cerrada con fechaFin = fechaInicio-1) restaurada como indefinida.
  //  2) Eliminar la fila del movimiento → desaparece de la agenda (que lista por rango de
  //     fechas). No hay FK de Cita→AsignacionSede, así que es seguro.
  const pred = await hallarPredecesor(asignacion);
  const predecesorSedeId = pred?.predecesorSedeId ?? null;

  await prisma.$transaction(async (tx) => {
    // Borrar el movimiento ANTES de restaurar el predecesor: si el predecesor
    // vuelve a quedar indefinido (fechaFin=null), no debe coexistir un instante
    // con el movimiento (también abierto) → respeta el índice "una sola abierta".
    await tx.asignacionSede.delete({ where: { id: asignacion.id } });
    if (pred) {
      await tx.asignacionSede.update({ where: { id: pred.predecesorId }, data: { activa: true, fechaFin: pred.restaurarFechaFin } });
    }
    await tx.auditLog.create({
      data: {
        usuarioId: req.user?.userId,
        accion: 'MOVIMIENTO_ELIMINADO',
        entidad: 'asignacion_sede',
        entidadId: asignacion.id,
        antes: { profesionalId: asignacion.profesionalId, sedeId: asignacion.sedeId, fechaInicio: asignacion.fechaInicio.toISOString().slice(0, 10), fechaFin: asignacion.fechaFin?.toISOString().slice(0, 10) ?? null },
        despues: { eliminado: true, predecesorRestaurado: !!pred, restauradoExacto: pred?.exacto ?? false, fechaFinRestaurada: pred?.restaurarFechaFin ? pred.restaurarFechaFin.toISOString().slice(0, 10) : null },
        sedeId: asignacion.sedeId,
        ip: req.ip,
      },
    });
  });

  // Refrescar la agenda al instante: invalida caché y emite socket para la sede
  // del movimiento (donde se quita la columna) y la sede previa (a donde vuelve).
  await notificarCambioMovimiento({
    profesionalId: asignacion.profesionalId,
    sedeId: asignacion.sedeId,
    sedeAnteriorId: predecesorSedeId,
    fechaInicio: asignacion.fechaInicio,
    fechaFin: asignacion.fechaFin,
  });

  res.json({ ok: true, predecesorRestaurado: !!predecesorSedeId });
});

export default router;
