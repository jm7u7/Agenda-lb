import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { invalidateDisponibilidadCache } from '../redis';
import { sincronizarReunionOutlook } from '../services/outlookCalendarService';

const router = Router();

// Permisos = bloqueos manuales por rango horario (tipo PERMISO, no recurrentes).
// Gestionados por la Coordinadora de Sedes (y admin) para bloquear a cualquier
// podóloga o fisioterapeuta en un rango de horas de un día (permisos, ausencias).
// Al ser bloqueos no recurrentes, la disponibilidad ya los respeta automáticamente.

const PROF_SELECT = {
  profesional: { select: { id: true, nombres: true, apellidos: true, tipo: true, colorAvatar: true } },
  creadoPorUsuario: { select: { id: true, nombre: true } },
} as const;

const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h! * 60 + m!; };

// Pacientes con cita ACTIVA que solapan un rango horario (para impedir bloquear sobre ellos).
async function citasEnConflicto(profesionalId: string, sedeId: string, fecha: string, horaInicio: string, horaFin: string) {
  const desdeMin = toMin(horaInicio), hastaMin = toMin(horaFin);
  const dayStart = new Date(`${fecha}T00:00:00`), dayEnd = new Date(`${fecha}T23:59:59`);
  const citas = await prisma.cita.findMany({
    where: {
      OR: [{ profesionalId }, { solicitadoProfesionalId: profesionalId }],
      sedeId,
      fecha: { gte: dayStart, lte: dayEnd },
      deletedAt: null,
      estado: { notIn: ['cancelada', 'no_show', 'reprogramada', 'completada'] },
    },
    select: {
      horaInicio: true, duracionMinutos: true, estado: true,
      paciente: { select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true, telefono: true } },
      servicio: { select: { nombre: true } },
    },
    orderBy: { horaInicio: 'asc' },
  });
  return citas
    .filter(c => { const ini = toMin(c.horaInicio); return ini < hastaMin && ini + c.duracionMinutos > desdeMin; })
    .map(c => ({
      horaInicio: c.horaInicio, estado: c.estado as string, servicio: c.servicio.nombre,
      paciente: `${c.paciente.nombres} ${c.paciente.apellidoPaterno} ${c.paciente.apellidoMaterno}`.trim(),
      telefono: c.paciente.telefono,
    }));
}

// Dueños que reparten su día entre pacientes y temas administrativos: Daniel y Yasica Doy.
// Las reuniones se bloquean en AMBAS agendas. Se identifican por nombre (misma convención
// que la integración de Outlook Calendar). Devuelve cada uno con su sede vigente.
async function profesionalesReunion(): Promise<{ id: string; nombre: string; sedeId: string }[]> {
  const profs = await prisma.profesional.findMany({
    where: {
      activo: true, deletedAt: null,
      apellidos: { contains: 'Doy', mode: 'insensitive' },
      OR: [
        { nombres: { contains: 'Daniel', mode: 'insensitive' } },
        { nombres: { contains: 'Yasica', mode: 'insensitive' } },
      ],
    },
    select: { id: true, nombres: true, apellidos: true },
  });
  const out: { id: string; nombre: string; sedeId: string }[] = [];
  for (const p of profs) {
    const asg = await prisma.asignacionSede.findFirst({
      where: { profesionalId: p.id, fechaFin: null },
      orderBy: { fechaInicio: 'desc' },
      select: { sedeId: true },
    });
    if (asg) out.push({ id: p.id, nombre: `${p.nombres} ${p.apellidos}`.trim(), sedeId: asg.sedeId });
  }
  return out;
}

// ─── GET /permisos?sedeId=X&fecha=YYYY-MM-DD ─────────────────────────────────
// Lectura abierta a cualquier usuario autenticado (la agenda los muestra a todos).
router.get('/', requireAuth, async (req, res) => {
  const { sedeId, fecha } = req.query as { sedeId?: string; fecha?: string };
  if (!sedeId) throw new AppError('sedeId requerido', 400);
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new AppError('fecha (YYYY-MM-DD) requerida', 400);

  const dayStart = new Date(`${fecha}T00:00:00`);
  const dayEnd = new Date(`${fecha}T23:59:59`);

  const permisos = await prisma.bloqueoAgenda.findMany({
    where: {
      tipo: 'PERMISO',
      esRecurrente: false,
      deletedAt: null,
      sedeId,
      fechaInicio: { lt: dayEnd },
      fechaFin: { gt: dayStart },
    },
    include: PROF_SELECT,
    orderBy: [{ fechaInicio: 'asc' }],
  });

  res.json(permisos);
});

// ─── POST /permisos ──────────────────────────────────────────────────────────
router.post('/', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const data = z.object({
    profesionalId: z.string().uuid(),
    sedeId: z.string().uuid(),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    horaInicio: z.string().regex(/^\d{2}:\d{2}$/),
    horaFin: z.string().regex(/^\d{2}:\d{2}$/),
    motivo: z.string().min(3).max(200),
  }).parse(req.body);

  if (data.horaFin <= data.horaInicio) {
    throw new AppError('La hora de fin debe ser mayor que la de inicio', 400);
  }

  const prof = await prisma.profesional.findUnique({
    where: { id: data.profesionalId },
    select: { tipo: true, activo: true, deletedAt: true },
  });
  if (!prof || !prof.activo || prof.deletedAt) throw new AppError('Profesional no encontrado', 404);
  // Podólogas, fisioterapeutas y baro (médico/máquina "Baro N"): se pueden bloquear
  // en un rango (ej. reunión de médicos → no atienden baro durante ese rato).
  if (prof.tipo !== 'podologa' && prof.tipo !== 'fisioterapeuta' && prof.tipo !== 'medico') {
    throw new AppError('Los permisos aplican a podólogas, fisioterapeutas y baropodometría', 400);
  }

  // No permitir bloquear sobre citas activas: rechazar y avisar (hay que reprogramar/cancelar primero).
  // Solo cuentan las citas vigentes (no canceladas, no-show, reprogramadas ni ya completadas).
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const desdeMin = toMin(data.horaInicio);
  const hastaMin = toMin(data.horaFin);
  const dayStart = new Date(`${data.fecha}T00:00:00`);
  const dayEnd = new Date(`${data.fecha}T23:59:59`);
  const citasDelDia = await prisma.cita.findMany({
    where: {
      // Baro "Solo X": la cita ocupa una MÁQUINA (profesionalId) pero pide a un médico
      // (solicitadoProfesionalId). Bloquear a cualquiera de los dos cuenta como conflicto.
      OR: [{ profesionalId: data.profesionalId }, { solicitadoProfesionalId: data.profesionalId }],
      sedeId: data.sedeId,
      fecha: { gte: dayStart, lte: dayEnd },
      deletedAt: null,
      estado: { notIn: ['cancelada', 'no_show', 'reprogramada', 'completada'] },
    },
    select: {
      horaInicio: true, duracionMinutos: true, estado: true,
      paciente: { select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true, telefono: true } },
      servicio: { select: { nombre: true } },
    },
    orderBy: { horaInicio: 'asc' },
  });
  const enConflicto = citasDelDia.filter(c => {
    const ini = toMin(c.horaInicio);
    return ini < hastaMin && ini + c.duracionMinutos > desdeMin; // solape [ini, ini+dur) con [desde, hasta)
  });
  if (enConflicto.length > 0) {
    // Devolvemos la LISTA de pacientes en el rango para que la coordinadora vea
    // exactamente quiénes están agendados y los gestione antes de bloquear.
    const pacientes = enConflicto.map(c => ({
      horaInicio: c.horaInicio,
      estado: c.estado as string,
      servicio: c.servicio.nombre,
      paciente: `${c.paciente.nombres} ${c.paciente.apellidoPaterno} ${c.paciente.apellidoMaterno}`.trim(),
      telefono: c.paciente.telefono,
    }));
    const muestra = pacientes.slice(0, 6).map(p => `${p.horaInicio} ${p.paciente}`).join(', ') + (pacientes.length > 6 ? '…' : '');
    res.status(409).json({
      error: 'CITAS_EN_RANGO',
      message: `No se puede bloquear ${data.horaInicio}–${data.horaFin}: hay ${pacientes.length} cita(s) agendada(s) en ese rango (${muestra}). Reprograma o cancela esas citas antes de bloquear el horario.`,
      statusCode: 409,
      totalCitas: pacientes.length,
      citas: pacientes,
    });
    return;
  }

  // fechaInicio/fechaFin como DateTime local (misma convención que disponibilidad).
  const fechaInicio = new Date(`${data.fecha}T${data.horaInicio}:00`);
  const fechaFin = new Date(`${data.fecha}T${data.horaFin}:00`);

  const permiso = await prisma.bloqueoAgenda.create({
    data: {
      profesionalId: data.profesionalId,
      sedeId: data.sedeId,
      tipo: 'PERMISO',
      esRecurrente: false,
      fechaInicio,
      fechaFin,
      horaInicio: data.horaInicio,
      horaFin: data.horaFin,
      motivo: data.motivo,
      creadoPor: req.user?.userId,
    },
    include: PROF_SELECT,
  });

  await invalidateDisponibilidadCache(data.sedeId, data.fecha);
  res.status(201).json(permiso);
});

// ─── POST /permisos/multiple — bloquear VARIOS profesionales a la vez ─────────
// Por cada profesional: si tiene pacientes en el rango, NO se bloquea y se reporta;
// los libres se bloquean. Resultado: { creados, conflictos } para que el frontend
// muestre a quiénes sí y a quiénes no (y por qué). Regla dura: nunca se bloquea a
// alguien con pacientes agendados.
router.post('/multiple', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const data = z.object({
    profesionalIds: z.array(z.string().uuid()).min(1).max(60),
    sedeId: z.string().uuid(),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    horaInicio: z.string().regex(/^\d{2}:\d{2}$/),
    horaFin: z.string().regex(/^\d{2}:\d{2}$/),
    motivo: z.string().min(3).max(200),
  }).parse(req.body);
  if (data.horaFin <= data.horaInicio) throw new AppError('La hora de fin debe ser mayor que la de inicio', 400);

  const ids = [...new Set(data.profesionalIds)];
  const profs = await prisma.profesional.findMany({
    where: { id: { in: ids }, activo: true, deletedAt: null },
    select: { id: true, nombres: true, apellidos: true, tipo: true },
  });
  const profPorId = new Map(profs.map((p) => [p.id, p]));

  const fechaInicio = new Date(`${data.fecha}T${data.horaInicio}:00`);
  const fechaFin = new Date(`${data.fecha}T${data.horaFin}:00`);

  const creados: { id: string; profesionalId: string; nombre: string }[] = [];
  const conflictos: { profesionalId: string; nombre: string; citas: Awaited<ReturnType<typeof citasEnConflicto>> }[] = [];
  const invalidos: { profesionalId: string; motivo: string }[] = [];

  for (const id of ids) {
    const prof = profPorId.get(id);
    if (!prof) { invalidos.push({ profesionalId: id, motivo: 'no encontrado' }); continue; }
    if (prof.tipo !== 'podologa' && prof.tipo !== 'fisioterapeuta' && prof.tipo !== 'medico') {
      invalidos.push({ profesionalId: id, motivo: 'tipo no bloqueable' });
      continue;
    }
    const nombre = `${prof.nombres.split(' ')[0]} ${prof.apellidos.split(' ')[0]}`.trim();
    const citas = await citasEnConflicto(id, data.sedeId, data.fecha, data.horaInicio, data.horaFin);
    if (citas.length > 0) { conflictos.push({ profesionalId: id, nombre, citas }); continue; }
    const permiso = await prisma.bloqueoAgenda.create({
      data: {
        profesionalId: id, sedeId: data.sedeId, tipo: 'PERMISO', esRecurrente: false,
        fechaInicio, fechaFin, horaInicio: data.horaInicio, horaFin: data.horaFin,
        motivo: data.motivo, creadoPor: req.user?.userId,
      },
    });
    creados.push({ id: permiso.id, profesionalId: id, nombre });
  }

  if (creados.length > 0) await invalidateDisponibilidadCache(data.sedeId, data.fecha);
  // SIEMPRE 2xx: es una operación por lotes con resultado PARCIAL (algunos bloqueados,
  // otros con pacientes en el rango). El frontend lee `conflictos` y muestra la lista; si
  // devolviéramos 409, el cliente lo trataría como error HTTP genérico ("Error desconocido")
  // y se perdería el detalle de quién tiene pacientes agendados.
  res.status(creados.length > 0 ? 201 : 200).json({ creados, conflictos, invalidos });
});

// ─── POST /permisos/reunion ───────────────────────────────────────────────────
// Reunión administrativa de Daniel y/o Yasica Doy: bloquea el mismo rango en su(s) agenda(s)
// con el texto indicado. `destinatario` define los 3 escenarios: solo Daniel, solo Yasica, o ambos.
router.post('/reunion', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const data = z.object({
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    horaInicio: z.string().regex(/^\d{2}:\d{2}$/),
    horaFin: z.string().regex(/^\d{2}:\d{2}$/),
    motivo: z.string().min(3).max(200),
    destinatario: z.enum(['daniel', 'yasica', 'ambos']).default('ambos'),
  }).parse(req.body);

  if (data.horaFin <= data.horaInicio) {
    throw new AppError('La hora de fin debe ser mayor que la de inicio', 400);
  }

  const todos = await profesionalesReunion();
  // Filtrar según el destinatario elegido (3 escenarios).
  const profs = data.destinatario === 'ambos'
    ? todos
    : todos.filter(p => p.nombre.toLowerCase().includes(data.destinatario));
  if (profs.length === 0) {
    const quien = data.destinatario === 'ambos' ? 'Daniel ni Yasica Doy' : `${data.destinatario === 'daniel' ? 'Daniel' : 'Yasica'} Doy`;
    throw new AppError(`No se encontró a ${quien} con sede vigente para la reunión`, 404, 'SIN_PROFESIONALES_REUNION');
  }

  // Todo-o-nada: si CUALQUIERA tiene pacientes en el rango, no se crea ninguna y se reporta.
  const conflictos: { profesional: string; citas: Awaited<ReturnType<typeof citasEnConflicto>> }[] = [];
  for (const p of profs) {
    const citas = await citasEnConflicto(p.id, p.sedeId, data.fecha, data.horaInicio, data.horaFin);
    if (citas.length) conflictos.push({ profesional: p.nombre, citas });
  }
  if (conflictos.length > 0) {
    const muestra = conflictos.map(c => `${c.profesional} (${c.citas.length})`).join(' · ');
    const citasPlanas = conflictos.flatMap(c => c.citas.map(x => ({ ...x, profesional: c.profesional })));
    res.status(409).json({
      error: 'CITAS_EN_RANGO',
      message: `No se puede agendar la reunión ${data.horaInicio}–${data.horaFin}: hay pacientes agendados en ese rango (${muestra}). Reprograma o cancela esas citas antes de bloquear el horario.`,
      statusCode: 409,
      conflictos,
      citas: citasPlanas,
    });
    return;
  }

  const fechaInicio = new Date(`${data.fecha}T${data.horaInicio}:00`);
  const fechaFin = new Date(`${data.fecha}T${data.horaFin}:00`);

  const creados = await prisma.$transaction(
    profs.map(p => prisma.bloqueoAgenda.create({
      data: {
        profesionalId: p.id,
        sedeId: p.sedeId,
        tipo: 'PERMISO',
        esRecurrente: false,
        esReunion: true, // → se pinta VERDE en la agenda
        fechaInicio,
        fechaFin,
        horaInicio: data.horaInicio,
        horaFin: data.horaFin,
        motivo: data.motivo,
        creadoPor: req.user?.userId,
      },
      include: PROF_SELECT,
    })),
  );

  // Invalidar caché de disponibilidad por cada sede afectada (puede ser una o dos).
  for (const sedeId of new Set(profs.map(p => p.sedeId))) {
    await invalidateDisponibilidadCache(sedeId, data.fecha);
  }

  // Replicar la reunión en la agenda del celular de cada profesional (Outlook/Gmail @limablue),
  // NO bloqueante: si falla, queda outlookSyncError y el reintentador lo reprocesa.
  for (const c of creados) void sincronizarReunionOutlook('crear', c.id);

  res.status(201).json({ ok: true, creados, profesionales: profs.map(p => p.nombre) });
});

// ─── DELETE /permisos/:id ─────────────────────────────────────────────────────
router.delete('/:id', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const b = await prisma.bloqueoAgenda.findUnique({ where: { id: req.params.id } });
  if (!b || b.deletedAt) throw new AppError('Permiso no encontrado', 404);
  if (b.tipo !== 'PERMISO') throw new AppError('Solo se pueden eliminar permisos aquí', 400);

  await prisma.bloqueoAgenda.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });

  await prisma.auditLog.create({
    data: {
      usuarioId: req.user?.userId,
      accion: 'PERMISO_ELIMINADO',
      entidad: 'bloqueo_agenda',
      entidadId: b.id,
      antes: { profesionalId: b.profesionalId, horaInicio: b.horaInicio, horaFin: b.horaFin, motivo: b.motivo },
      despues: { deletedAt: new Date().toISOString() },
      sedeId: b.sedeId ?? undefined,
      ip: req.ip,
    },
  });

  if (b.sedeId) await invalidateDisponibilidadCache(b.sedeId, b.fechaInicio.toISOString().slice(0, 10));

  // Si era una reunión, quitar el evento del calendario del celular del profesional.
  if (b.esReunion) void sincronizarReunionOutlook('cancelar', b.id);

  res.json({ ok: true });
});

export default router;
