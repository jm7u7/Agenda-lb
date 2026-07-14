import { Router } from 'express';
import { z } from 'zod';
import { MotivoMovimiento } from '@prisma/client';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { crearMovimiento, crearMovimientoEnTx, eliminarMovimientoEnTx, hallarPredecesor, previewMovimiento, notificarCambioMovimiento, MOTIVO_LABELS } from '../services/asignacionService';
import { CitasPendientesError } from '../middleware/errorHandler';
import { fechaDb } from '../utils/fechaLima';
import { auditEnTx } from '../services/audit';
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
  profesionalId: z.string().uuid().optional(),
  sedeId: z.string().uuid().optional(),
  fechaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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

// (hallarPredecesor y la eliminación transaccional viven en asignacionService —
//  las comparten el DELETE y la edición estructural del PUT.)

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

  const pred = await hallarPredecesor(prisma, asignacion);
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
// Edita un movimiento: SEDE DESTINO, fecha fin, motivo y notas.
// - Cambiar la SEDE exige gestionar antes las citas activas del período (igual que al
//   crear) → 409 CITAS_PENDIENTES. Si no, quedarían citas huérfanas en la sede vieja.
// - Cambiar la FECHA FIN de un movimiento temporal SINCRONIZA su RETORNO automático
//   (la asignación que devuelve a la sede matriz): se corre su inicio, se crea si el
//   movimiento pasa de indefinido a temporal, o se elimina si pasa a indefinido.
router.put('/:id', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const data = editarSchema.parse(req.body);

  const existente = await prisma.asignacionSede.findUnique({
    where: { id: req.params.id },
  });
  if (!existente) throw new AppError('Movimiento no encontrado', 404);

  // ── Edición ESTRUCTURAL (cambia la podóloga o la fecha de inicio) ────────────
  // No se puede parchear la fila: al crear el movimiento se CERRÓ la asignación previa
  // en fechaInicio-1 (y quizá se creó un retorno). La forma correcta y atómica es
  // RECREAR: deshacer el movimiento (restaurando el estado previo exacto) y volver a
  // crearlo con los datos nuevos — ambas cosas en UNA transacción, reusando la lógica
  // ya probada de DELETE y POST (incluye chequeo de citas, solapes y retorno).
  const cambiaProfesional = data.profesionalId !== undefined && data.profesionalId !== existente.profesionalId;
  const cambiaFechaInicio = data.fechaInicio !== undefined
    && fechaDb(data.fechaInicio).getTime() !== fechaDb(existente.fechaInicio.toISOString().slice(0, 10)).getTime();

  if (cambiaProfesional || cambiaFechaInicio) {
    try {
      const { asignacion: recreado, sedeAnteriorId } = await prisma.$transaction(async (tx) => {
        await eliminarMovimientoEnTx(tx, existente, { usuarioId: req.user?.userId, ip: req.ip });
        const creado = await crearMovimientoEnTx(tx, {
          profesionalId: data.profesionalId ?? existente.profesionalId,
          sedeId: data.sedeId ?? existente.sedeId,
          fechaInicio: data.fechaInicio ?? existente.fechaInicio.toISOString().slice(0, 10),
          fechaFin: data.fechaFin !== undefined
            ? data.fechaFin
            : (existente.fechaFin?.toISOString().slice(0, 10) ?? null),
          motivo: data.motivo ?? existente.motivo,
          reemplazaA: existente.reemplazaA,
          notas: data.notas !== undefined ? data.notas : existente.notas,
          creadoPor: req.user!.userId,
        });
        await auditEnTx(tx, {
          usuarioId: req.user?.userId, ip: req.ip,
          accion: 'MOVIMIENTO_EDITADO',
          entidad: 'asignacion_sede',
          entidadId: creado.asignacion.id,
          antes: {
            recreadoDesde: existente.id,
            profesionalId: existente.profesionalId, sedeId: existente.sedeId,
            fechaInicio: existente.fechaInicio.toISOString().slice(0, 10),
            fechaFin: existente.fechaFin?.toISOString().slice(0, 10) ?? null,
          },
          despues: {
            profesionalId: creado.asignacion.profesionalId, sedeId: creado.asignacion.sedeId,
            fechaInicio: creado.asignacion.fechaInicio.toISOString().slice(0, 10),
            fechaFin: creado.asignacion.fechaFin?.toISOString().slice(0, 10) ?? null,
          },
          sedeId: creado.asignacion.sedeId,
        });
        return creado;
      });

      // Refrescar agenda: sede/rango viejos y nuevos (y sedes previas restauradas).
      await notificarCambioMovimiento({
        profesionalId: existente.profesionalId,
        sedeId: existente.sedeId,
        sedeAnteriorId: null,
        fechaInicio: existente.fechaInicio,
        fechaFin: existente.fechaFin,
      });
      await notificarCambioMovimiento({
        profesionalId: recreado.profesionalId,
        sedeId: recreado.sedeId,
        sedeAnteriorId: sedeAnteriorId ?? null,
        fechaInicio: recreado.fechaInicio,
        fechaFin: recreado.fechaFin,
      });

      const completo = await prisma.asignacionSede.findUnique({ where: { id: recreado.id }, include: INCLUDE_COMPLETO });
      return res.json(completo);
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
  }

  const cambiaSede = data.sedeId !== undefined && data.sedeId !== existente.sedeId;
  const nuevaFechaFin = data.fechaFin !== undefined
    ? (data.fechaFin ? fechaDb(data.fechaFin) : null)
    : existente.fechaFin;
  const cambiaFechaFin = data.fechaFin !== undefined
    && (nuevaFechaFin?.getTime() ?? null) !== (existente.fechaFin?.getTime() ?? null);

  if (cambiaSede) {
    const totalCitas = await prisma.cita.count({
      where: {
        profesionalId: existente.profesionalId,
        fecha: { gte: existente.fechaInicio, lte: nuevaFechaFin ?? addDays(existente.fechaInicio, 365) },
        estado: { in: ['agendada', 'confirmada', 'llego', 'en_atencion'] },
        deletedAt: null,
      },
    });
    if (totalCitas > 0) {
      return res.status(409).json({
        error: 'CITAS_PENDIENTES',
        message: `Hay ${totalCitas} cita(s) activa(s) en el período; gestiónalas antes de cambiar la sede.`,
        totalCitas,
        sedeOrigenId: existente.sedeId,
      });
    }
  }

  // Localizar el RETORNO automático asociado (si este movimiento es temporal y cerró
  // una asignación previa): la fila que devuelve a la sede matriz al día siguiente del fin.
  const pred = await hallarPredecesor(prisma, existente);
  let retorno: { id: string; fechaFin: Date | null } | null = null;
  if (existente.fechaFin && pred) {
    const rIni = addDays(existente.fechaFin, 1);
    const d0 = new Date(Date.UTC(rIni.getUTCFullYear(), rIni.getUTCMonth(), rIni.getUTCDate(), 0, 0, 0));
    const d1 = new Date(Date.UTC(rIni.getUTCFullYear(), rIni.getUTCMonth(), rIni.getUTCDate(), 23, 59, 59));
    retorno = await prisma.asignacionSede.findFirst({
      // SOLO filas con la marca esRetorno (un movimiento real nunca se confunde con el
      // retorno). SIN filtro de sede: aunque el usuario haya REDIRIGIDO el retorno a otra
      // sede, sigue siendo el retorno de este movimiento y debe sincronizarse/borrarse.
      where: { profesionalId: existente.profesionalId, esRetorno: true, fechaInicio: { gte: d0, lte: d1 } },
      select: { id: true, fechaFin: true },
    });
  }

  // Nuevo rango no puede solapar OTRA asignación (se excluyen este movimiento y su retorno,
  // que se sincroniza abajo). Mismo chequeo que al crear.
  if (cambiaFechaFin) {
    const conflicto = await prisma.asignacionSede.findFirst({
      where: {
        profesionalId: existente.profesionalId,
        activa: true,
        id: { notIn: [existente.id, ...(retorno ? [retorno.id] : [])] },
        ...(nuevaFechaFin ? { fechaInicio: { lte: nuevaFechaFin } } : {}),
        OR: [{ fechaFin: null }, { fechaFin: { gte: existente.fechaInicio } }],
      },
      include: { sede: { select: { nombre: true } } },
    });
    if (conflicto) {
      throw new AppError(
        `Conflicto: ya hay una asignación en ${conflicto.sede.nombre} que se solapa con el nuevo rango`,
        409, 'CONFLICTO_ASIGNACION',
      );
    }
  }

  const actualizado = await prisma.$transaction(async (tx) => {
    // Sincronizar el retorno automático con la nueva fecha fin (antes de tocar este
    // movimiento, para respetar el índice "una sola asignación abierta por profesional").
    if (cambiaFechaFin) {
      if (retorno && nuevaFechaFin) {
        const nuevoIni = addDays(nuevaFechaFin, 1);
        if (retorno.fechaFin && retorno.fechaFin < nuevoIni) {
          // La base original terminaba antes del nuevo retorno → el retorno ya no aplica.
          await tx.asignacionSede.delete({ where: { id: retorno.id } });
        } else {
          await tx.asignacionSede.update({ where: { id: retorno.id }, data: { fechaInicio: nuevoIni } });
        }
      } else if (retorno && !nuevaFechaFin) {
        // El movimiento pasa a INDEFINIDO → el retorno sobra (y no pueden quedar dos abiertas).
        await tx.asignacionSede.delete({ where: { id: retorno.id } });
      } else if (!retorno && nuevaFechaFin && pred) {
        // Era indefinido y ahora es TEMPORAL → crear el retorno a la sede matriz.
        const nuevoIni = addDays(nuevaFechaFin, 1);
        if (existente.cierraFechaFin === null || existente.cierraFechaFin >= nuevoIni) {
          const sedeMatriz = await tx.sede.findUnique({ where: { id: pred.predecesorSedeId }, select: { nombre: true } });
          const motivoRet = (data.motivo ?? existente.motivo) as MotivoMovimiento;
          await tx.asignacionSede.create({
            data: {
              profesionalId: existente.profesionalId,
              sedeId: pred.predecesorSedeId,
              fechaInicio: nuevoIni,
              fechaFin: existente.cierraFechaFin,
              activa: true,
              esRetorno: true,
              motivo: motivoRet,
              notas: `Retorno automático a ${sedeMatriz?.nombre ?? 'su sede'} tras ${MOTIVO_LABELS[motivoRet]}`,
              creadoPor: req.user?.userId,
            },
          });
        }
      }
    }

    const upd = await tx.asignacionSede.update({
      where: { id: req.params.id },
      data: {
        ...(cambiaSede ? { sedeId: data.sedeId } : {}),
        ...(data.fechaFin !== undefined ? { fechaFin: nuevaFechaFin } : {}),
        // Editar las FECHAS de una fila es afirmar su vigencia: se reactiva. Es seguro
        // porque el chequeo de solape de arriba ya garantizó que no pisa otra activa.
        // (Sin esto, editar una fila cerrada dejaba un "zombi": rango vivo + activa=false,
        // visible en la agenda pero invisible en el tablero de movimientos.)
        ...(cambiaFechaFin ? { activa: true } : {}),
        ...(data.motivo !== undefined ? { motivo: data.motivo } : {}),
        ...(data.notas !== undefined ? { notas: data.notas } : {}),
      },
      include: INCLUDE_COMPLETO,
    });

    await auditEnTx(tx, {
      usuarioId: req.user?.userId,
      accion: 'MOVIMIENTO_EDITADO',
      entidad: 'asignacion_sede',
      entidadId: existente.id,
      antes: {
        sedeId: existente.sedeId,
        fechaFin: existente.fechaFin?.toISOString().slice(0, 10) ?? null,
        motivo: existente.motivo, notas: existente.notas,
      },
      despues: {
        sedeId: upd.sedeId,
        fechaFin: upd.fechaFin?.toISOString().slice(0, 10) ?? null,
        motivo: upd.motivo, notas: upd.notas,
      },
      sedeId: upd.sedeId,
      ip: req.ip,
    });

    return upd;
  });

  // Refrescar agenda al instante: sede nueva y, si cambió, también la vieja.
  await notificarCambioMovimiento({
    profesionalId: existente.profesionalId,
    sedeId: actualizado.sedeId,
    sedeAnteriorId: cambiaSede ? existente.sedeId : null,
    fechaInicio: existente.fechaInicio,
    fechaFin: nuevaFechaFin,
  });

  res.json(actualizado);
});

// ─── DELETE /movimientos/:id ───────────────────────────────────────────────────
router.delete('/:id', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const asignacion = await prisma.asignacionSede.findUnique({
    where: { id: req.params.id },
  });
  if (!asignacion) throw new AppError('Movimiento no encontrado', 404);

  // Igual que al CREAR un movimiento: si hay citas activas del profesional en el período
  // (de hoy en adelante), eliminarlo las dejaría huérfanas en una sede donde ya no estará.
  // Se exige gestionarlas primero — misma regla y mismo código de error que el POST.
  const hoy = fechaDb(new Date().toISOString().slice(0, 10));
  const desde = asignacion.fechaInicio > hoy ? asignacion.fechaInicio : hoy;
  const hasta = asignacion.fechaFin ?? addDays(desde, 365);
  if (hasta >= desde) {
    const citasPendientes = await prisma.cita.count({
      where: {
        profesionalId: asignacion.profesionalId,
        sedeId: asignacion.sedeId,
        fecha: { gte: desde, lte: hasta },
        estado: { in: ['agendada', 'confirmada', 'llego', 'en_atencion'] },
        deletedAt: null,
      },
    });
    if (citasPendientes > 0) {
      return res.status(409).json({
        error: 'CITAS_PENDIENTES',
        message: `Hay ${citasPendientes} cita(s) activa(s) del período en esa sede; gestiónalas antes de eliminar el movimiento.`,
        totalCitas: citasPendientes,
        sedeOrigenId: asignacion.sedeId,
      });
    }
  }

  // Se puede eliminar tanto un movimiento futuro como uno ACTIVO (ya iniciado):
  // en ambos casos se restaura la asignación previa (a su estado EXACTO), se borra
  // el retorno automático si era temporal, y se refresca la agenda. La lógica vive
  // en asignacionService.eliminarMovimientoEnTx (compartida con la edición estructural).
  const { predecesorSedeId } = await prisma.$transaction((tx) =>
    eliminarMovimientoEnTx(tx, asignacion, { usuarioId: req.user?.userId, ip: req.ip }),
  );

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
